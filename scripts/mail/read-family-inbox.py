#!/usr/bin/env python3
"""Read-only Gmail reply intake. No SMTP, flag updates, expunge, AI or attachments."""
import datetime
from email import policy
from email.parser import BytesParser
from email.utils import getaddresses
from html.parser import HTMLParser
import imaplib
import json
import os
import re
import ssl
import sys

MAX_SOURCE = 256 * 1024
BATCH = 50
MAX_TEXT = 5000

class MailFailure(Exception):
    pass

def without_comments(value):
    result, depth, quoted, escape = [], 0, False, False
    for char in value:
        if escape:
            if depth == 0: result.append(char)
            escape = False
        elif char == '\\':
            escape = True
            if depth == 0: result.append(char)
        elif char == '"' and depth == 0:
            quoted = not quoted
            result.append(char)
        elif not quoted and char == '(':
            depth += 1
        elif not quoted and char == ')':
            if depth == 0: return ''
            depth -= 1
        elif depth == 0:
            result.append(char)
    return '' if depth or quoted or escape else ''.join(result)

def authenticated_sender(message, address):
    # Fixed Gmail TLS mailbox only. Trust the first Authentication-Results stamped
    # by Gmail's receiving service, never ARC results or arbitrary authserv-ids.
    results = message.get_all('Authentication-Results', [])
    if not results: return False
    value = without_comments(str(results[0]))
    parts = value.split(';')
    if parts[0].strip().lower() != 'mx.google.com': return False
    domain = address.rsplit('@', 1)[-1].lower()
    for clause in parts[1:]:
        if not re.match(r'^\s*dmarc=pass(?:\s|$)', clause, re.I): continue
        matched = re.search(r'\bheader\.from\s*=\s*(?:"([A-Za-z0-9.-]+)"|([A-Za-z0-9.-]+))(?=\s|$)', clause, re.I)
        if matched and (matched[1] or matched[2]).lower() == domain: return True
    return False

class PlainHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.stack = [], []
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        hidden = tag in ('script', 'style', 'head', 'blockquote') or bool(set(attrs.get('class', '').split()) & {'gmail_quote', 'gmail_attr', 'yahoo_quoted'})
        hidden = hidden or any(value for _, value in self.stack)
        if tag not in ('br', 'hr', 'img', 'meta', 'link', 'input', 'wbr', 'source', 'area', 'base', 'embed', 'param', 'col'):
            self.stack.append((tag, hidden))
        if not hidden and tag in ('p', 'br', 'div', 'li'): self.parts.append('\n')
    def handle_endtag(self, tag):
        for index in range(len(self.stack)-1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break
        if not any(value for _, value in self.stack) and tag in ('p', 'div', 'li'): self.parts.append('\n')
    def handle_data(self, data):
        if not any(value for _, value in self.stack): self.parts.append(data)

def strip_quotes(text):
    # Direction-formatting marks are layout metadata, not spoken reply text.
    text = re.sub(r'[\u200e\u200f\u202a-\u202e\u2066-\u2069]', '', text)
    lines = text.replace('\r\n', '\n').splitlines()
    result, index = [], 0
    while index < len(lines):
        line = lines[index]
        # Gmail's Hebrew attribution can span multiple lines: בתאריך ... מאת <...>:
        attribution = None
        if re.match(r'^\s*(?:On\b|בתאריך\s)', line, re.I):
            for end in range(index, min(index+6, len(lines))):
                joined = ' '.join(lines[index:end+1]).strip()
                if re.fullmatch(r'(?:On .{1,800}wrote:|בתאריך .{1,800}(?:מאת|כתב|כתבה|נכתב).{0,300}:)', joined, re.I):
                    attribution = end
                    break
        if attribution is not None:
            index = attribution + 1
            # Explicit > quoting lets us retain an unquoted bottom-posted reply.
            if index < len(lines) and any(v.lstrip().startswith('>') for v in lines[index:]):
                continue
            break
        if re.match(r'^\s*[-]{5,}\s*Original Message\s*[-]{5,}', line, re.I): break
        if not line.lstrip().startswith('>'): result.append(line)
        index += 1
    return '\n'.join(result).strip()

def body_text(message):
    # Prefer plain text, but inspect the HTML alternative if plain is quote-only.
    for subtype in ('plain', 'html'):
        part = message.get_body(preferencelist=(subtype,))
        if part is None: continue
        text = part.get_content()
        if not isinstance(text, str): continue
        if subtype == 'html':
            parser = PlainHTML(); parser.feed(text); text = ''.join(parser.parts)
        text = strip_quotes(text)
        if text: return text
    return ''

def identify_reply(message, parents):
    addresses = getaddresses([str(v) for v in message.get_all('From', [])])
    if len(addresses) != 1: return None, 'sender'
    sender = addresses[0][1].lower()
    if not re.fullmatch(r'[^\s<>@]+@[A-Za-z0-9.-]+', sender): return None, 'sender'
    keys = re.findall(r'<[^<>\s]{1,200}>', ' '.join(str(v) for name in ('In-Reply-To', 'References') for v in message.get_all(name, [])))
    matches = {parents[key] for key in keys if key in parents}
    if not matches: return None, 'unrelated'
    if len(matches) != 1: return None, 'ambiguous'
    if not authenticated_sender(message, sender): return None, 'authentication'
    return {'parentId': matches.pop(), 'sender': sender}, None

def parse_reply(source, parents, uid, include_empty=False):
    message = BytesParser(policy=policy.default).parsebytes(source)
    item, reason = identify_reply(message, parents)
    if not item: return None, reason
    text = body_text(message)
    if (not text and not include_empty) or len(text.encode('utf-16-le', errors='replace')) // 2 > MAX_TEXT: return None, 'body'
    # XML 1.0 is used by the telephone bridge; never import text that would
    # make its reader fail when a caller opens this message.
    if re.search(r'[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff\ufffe\uffff]', text): return None, 'body'
    message_ids = message.get_all('Message-ID', [])
    message_id = str(message_ids[0]).strip() if len(message_ids) == 1 else ''
    if not re.fullmatch(r'<[^<>\s]{1,200}>', message_id): message_id = ''
    return {**item, 'uid': uid, 'messageId': message_id, 'text': text, 'bodyUnavailable': not bool(text),
            'hasAttachments': any(p.get_content_disposition() == 'attachment' for p in message.walk())}, None

def read_mail(config, factory=imaplib.IMAP4_SSL):
    user, password = os.environ.get('SMTP_USER', ''), os.environ.get('SMTP_PASS', '')
    if os.environ.get('SMTP_HOST', '').lower() != 'smtp.gmail.com' or not user or not password:
        raise MailFailure('INBOUND_NOT_CONFIGURED')
    context = ssl.create_default_context(); context.minimum_version = ssl.TLSVersion.TLSv1_2
    client = None
    try:
        client = factory('imap.gmail.com', port=993, ssl_context=context, timeout=12)
        try: client.login(user, password)
        except imaplib.IMAP4.error: raise MailFailure('INBOUND_LOGIN_FAILED') from None
        status, _ = client.select('INBOX', readonly=True)
        if status != 'OK': raise MailFailure('INBOUND_MAILBOX_UNAVAILABLE')
        validity = int(client.response('UIDVALIDITY')[1][0])
        cursor = int(config.get('cursor', 0)) if int(config.get('uidValidity', 0)) == validity else 0
        date = datetime.date.fromisoformat(config['since']).strftime('%d-%b-%Y')
        criteria = ['SINCE', date]
        if cursor: criteria += ['UID', str(cursor + 1) + ':*']
        status, found = client.uid('SEARCH', None, *criteria)
        if status != 'OK': raise MailFailure('INBOUND_SEARCH_FAILED')
        uids = sorted({int(v) for v in (found[0] or b'').split() if int(v) > cursor})
        selected, replies, skipped = uids[:BATCH], [], {}
        def skip(reason): skipped[reason] = skipped.get(reason, 0) + 1
        for uid in selected:
            status, header_parts = client.uid('FETCH', str(uid), '(RFC822.SIZE BODY.PEEK[HEADER.FIELDS (FROM MESSAGE-ID IN-REPLY-TO REFERENCES AUTHENTICATION-RESULTS)])')
            if status != 'OK': raise MailFailure('INBOUND_FETCH_FAILED')
            pairs = [p for p in header_parts if isinstance(p, tuple)]
            if len(pairs) != 1: raise MailFailure('INBOUND_INVALID_RESPONSE')
            if len(pairs[0][1]) > 32768: skip('oversized'); continue
            size = re.search(rb'RFC822.SIZE\s+(\d+)', pairs[0][0])
            if not size: raise MailFailure('INBOUND_INVALID_RESPONSE')
            header = BytesParser(policy=policy.default).parsebytes(pairs[0][1])
            item, reason = identify_reply(header, config['parents'])
            if not item: skip(reason); continue
            if int(size[1]) > MAX_SOURCE: skip('oversized'); continue
            status, parts = client.uid('FETCH', str(uid), '(BODY.PEEK[]<0.' + str(MAX_SOURCE + 1) + '>)')
            if status != 'OK': raise MailFailure('INBOUND_FETCH_FAILED')
            sources = [p[1] for p in parts if isinstance(p, tuple)]
            if len(sources) != 1 or len(sources[0]) > MAX_SOURCE or len(sources[0]) != int(size[1]): raise MailFailure('INBOUND_INVALID_RESPONSE')
            try: item, reason = parse_reply(sources[0], config['parents'], uid, include_empty=bool(config.get('repair')))
            except (LookupError, UnicodeError, ValueError): item, reason = None, 'body'
            if item: replies.append(item)
            else: skip(reason)
        return {'ok': True, 'uidValidity': validity, 'cursor': max(selected, default=cursor),
                'scanned': len(selected), 'pending': len(uids) > BATCH, 'skipped': skipped, 'replies': replies}
    except MailFailure: raise
    except Exception: raise MailFailure('INBOUND_UNAVAILABLE') from None
    finally:
        if client:
            try: client.logout()
            except Exception: pass

if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(256 * 1024 + 1)
        if len(raw) > 256 * 1024: raise MailFailure('INBOUND_INPUT_LIMIT')
        result = read_mail(json.loads(raw))
    except MailFailure as error: result = {'ok': False, 'code': str(error)}
    except Exception: result = {'ok': False, 'code': 'INBOUND_INVALID_INPUT'}
    print(json.dumps(result, ensure_ascii=False))
