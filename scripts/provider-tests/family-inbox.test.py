import importlib.util
from pathlib import Path
from email.message import EmailMessage
import imaplib
import os
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('family_mail', Path(__file__).resolve().parents[1] / 'mail/read-family-inbox.py')
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
PARENT = '<11111111-1111-1111-1111-111111111111@mirkam.invalid>'
PARENTS = {PARENT: 'parent-one'}
def email(sender='family@example.test', authentication='mx.google.com; dmarc=pass (p=NONE) header.from=example.test', text='שלום, אנחנו כאן בשבילך.'):
    msg = EmailMessage()
    msg['From'] = sender; msg['To'] = 'line@gmail.com'; msg['Message-ID'] = '<reply-one@example.test>'
    msg['In-Reply-To'] = PARENT
    if authentication: msg['Authentication-Results'] = authentication
    msg.set_content(text)
    return msg

class Parsing(unittest.TestCase):
    def test_hebrew_multiline_gmail_attribution_is_not_reply_content(self):
        quote='בתאריך יום ב׳, 19 באוק׳ 2026,\n13:26, מאת\n<line@gmail.com>:\n> הודעה ישנה'
        self.assertEqual(m.parse_reply(email(text=quote).as_bytes(),PARENTS,1)[1],'body')
        item,error=m.parse_reply(email(text=quote).as_bytes(),PARENTS,1,include_empty=True)
        self.assertIsNone(error);self.assertTrue(item['bodyUnavailable']);self.assertEqual(item['text'],'')
        item,error=m.parse_reply(email(text='זו התשובה שלי.\n\n'+quote).as_bytes(),PARENTS,1)
        self.assertEqual(item['text'],'זו התשובה שלי.')
        self.assertEqual(m.parse_reply(email(text='\u202b'+quote+'\u202c').as_bytes(),PARENTS,1)[1],'body')
    def test_bottom_posted_answer_survives_explicit_plain_quotes(self):
        text='בתאריך יום ב׳, מאת <line@gmail.com>:\n> הודעה ישנה\n\nאני מחכה לך בבית.'
        self.assertEqual(m.parse_reply(email(text=text).as_bytes(),PARENTS,1)[0]['text'],'אני מחכה לך בבית.')
    def test_html_recovers_answer_when_plain_alternative_is_only_attribution(self):
        msg=email(text='בתאריך יום ב׳, מאת <line@gmail.com>:\n> ישן')
        msg.add_alternative('<div class="gmail_quote"><div class="gmail_attr">בתאריך אתמול מאת מישהו:</div><blockquote>ישן</blockquote></div><div>אנחנו מתגעגעים אליך.</div>',subtype='html')
        item,error=m.parse_reply(msg.as_bytes(),PARENTS,1)
        self.assertIsNone(error);self.assertEqual(item['text'],'אנחנו מתגעגעים אליך.')
    def test_html_quoted_history_and_date_in_real_answer(self):
        msg=email();msg.set_content('<div>בתאריך שנקבע נבוא לבקר.</div><div class="gmail_attr">בתאריך אתמול, מאת מישהו:</div><blockquote><div>ישן</div></blockquote>',subtype='html')
        self.assertEqual(m.parse_reply(msg.as_bytes(),PARENTS,1)[0]['text'],'בתאריך שנקבע נבוא לבקר.')
    def test_hebrew_mime_reply_matches_parent_without_rewriting(self):
        msg=email(text='הכוונה הייתה כלא, ולא הכל.\nנפגש בקרוב!')
        item, error=m.parse_reply(msg.as_bytes(), PARENTS, 4)
        self.assertIsNone(error); self.assertEqual(item['parentId'], 'parent-one')
        self.assertEqual(item['text'], 'הכוונה הייתה כלא, ולא הכל.\nנפגש בקרוב!')
        self.assertEqual(item['sender'], 'family@example.test')
    def test_non_xml_control_characters_cannot_break_the_telephone_reader(self):
        for char in ['\x00', '\uffff']:
            with self.subTest(char=repr(char)):
                self.assertEqual(m.parse_reply(email(text='שלום'+char+'משפחה').as_bytes(),PARENTS,1)[1],'body')
        self.assertIsNone(m.parse_reply(email(text='שלום\nמשפחה\tיקרה').as_bytes(),PARENTS,1)[1])
        normalized,error=m.parse_reply(email(text='שלום\x0bמשפחה').as_bytes(),PARENTS,1)
        self.assertIsNone(error);self.assertEqual(normalized['text'],'שלום\nמשפחה')
    def test_sender_authentication_is_required_and_domain_aligned(self):
        for value in [None, 'attacker.example; dmarc=pass header.from=example.test', 'mx.google.com; dmarc=fail header.from=example.test', 'mx.google.com; dmarc=pass header.from=other.test', 'mx.google.com; dkim=pass header.d=example.test', 'mx.google.com; dmarc=fail (dmarc=pass header.from=example.test)', 'mx.google.com; dmarc=pass (header.from=example.test)', 'mx.google.com; dmarc=pass header.from=example.test.evil']:
            with self.subTest(value=value): self.assertEqual(m.parse_reply(email(authentication=value).as_bytes(), PARENTS, 1)[1], 'authentication')
    def test_duplicate_from_and_forged_authentication_prefix_rejected(self):
        msg=email(sender='family@example.test, attacker@example.test')
        self.assertEqual(m.parse_reply(msg.as_bytes(), PARENTS, 1)[1], 'sender')
        msg=email(authentication='attacker.test; dmarc=pass header.from=example.test')
        msg['Authentication-Results']='mx.google.com; dmarc=pass header.from=example.test'
        self.assertEqual(m.parse_reply(msg.as_bytes(), PARENTS, 1)[1], 'authentication')
    def test_unrelated_and_cross_thread_messages_are_not_guessed_from_subject(self):
        msg=email(); del msg['In-Reply-To']; msg['Subject']='Re: מרקם ליין'
        self.assertEqual(m.parse_reply(msg.as_bytes(), PARENTS, 1)[1], 'unrelated')
        msg['In-Reply-To']=PARENT; msg['References']='<other@mirkam.invalid>'
        self.assertEqual(m.parse_reply(msg.as_bytes(), {**PARENTS,'<other@mirkam.invalid>':'other-parent'}, 1)[1], 'ambiguous')
    def test_html_is_text_only_and_attachments_are_not_read_as_message(self):
        msg=email(); msg.add_alternative('<html><head><style>private css</style></head><body><p>שלום מהמשפחה</p><script>evil()</script><p>נתראה</p></body></html>',subtype='html')
        # Remove plain alternative to exercise HTML-only clients.
        del msg.get_payload()[0]
        msg.add_attachment(b'PRIVATE ATTACHMENT',maintype='application',subtype='pdf',filename='private.pdf')
        item,error=m.parse_reply(msg.as_bytes(),PARENTS,1)
        self.assertIsNone(error);self.assertIn('שלום מהמשפחה',item['text']);self.assertTrue(item['hasAttachments'])
        self.assertNotIn('evil',item['text']);self.assertNotIn('PRIVATE',item['text']);self.assertNotIn('private css',item['text'])
    def test_explicit_quoted_history_removed_and_long_body_rejected(self):
        item,error=m.parse_reply(email(text='זו התשובה החדשה.\n\nOn Monday, someone wrote:\nold text').as_bytes(),PARENTS,1)
        self.assertIsNone(error);self.assertEqual(item['text'],'זו התשובה החדשה.')
        self.assertEqual(m.parse_reply(email(text='א'*5001).as_bytes(),PARENTS,1)[1],'body')

class FakeIMAP:
    def __init__(self, host, **kwargs):
        self.host=host;self.kwargs=kwargs;self.calls=[];self.logged_out=False
        self.source=email().as_bytes();self.large=False;self.auth_fail=False
    def login(self,*args):
        self.calls.append(('login',))
        if self.auth_fail: raise imaplib.IMAP4.error('SECRET PASSWORD RAW PROVIDER RESPONSE')
    def select(self,mailbox,readonly=False):
        assert mailbox=='INBOX' and readonly is True
        self.calls.append(('readonly',));return 'OK',[b'2']
    def response(self,name):return name,[b'42']
    def uid(self,command,*args):
        self.calls.append((command,*args))
        if command=='SEARCH':return 'OK',[b'1 2']
        if 'HEADER.FIELDS' in args[1]:return 'OK',[(b'1 (RFC822.SIZE '+str(300000 if self.large else len(self.source)).encode()+b')',self.source.split(b'\n\n')[0]+b'\n\n')]
        assert 'BODY.PEEK[]<0.262145>' in args[1]
        return 'OK',[(b'body',self.source)]
    def logout(self):self.logged_out=True

class Mailbox(unittest.TestCase):
    def setUp(self):
        self.env=patch.dict(os.environ,{'SMTP_HOST':'smtp.gmail.com','SMTP_USER':'line@gmail.com','SMTP_PASS':'test-private-password'})
        self.env.start();self.addCleanup(self.env.stop)
    def run_box(self,**options):
        box=FakeIMAP('unused')
        for key,value in options.items():setattr(box,key,value)
        def factory(host,**kwargs):box.host=host;box.kwargs=kwargs;return box
        result=m.read_mail({'parents':PARENTS,'since':'2026-10-01','cursor':1,'uidValidity':42},factory)
        return result,box
    def test_fixed_tls_endpoint_and_readonly_peek_never_update_flags(self):
        result,box=self.run_box();self.assertEqual(result['cursor'],2);self.assertEqual(result['scanned'],1);self.assertEqual(len(result['replies']),1)
        self.assertEqual(box.host,'imap.gmail.com');self.assertEqual(box.kwargs['port'],993)
        self.assertTrue(box.kwargs['ssl_context'].check_hostname);self.assertTrue(box.logged_out)
        self.assertFalse(any(call[0] in ('STORE','EXPUNGE','APPEND','MOVE','COPY') for call in box.calls))
    def test_oversized_mail_skipped_before_downloading_body(self):
        result,box=self.run_box(large=True);self.assertEqual(result['replies'],[]);self.assertEqual(result['skipped']['oversized'],1)
        self.assertFalse(any(call[0]=='FETCH' and 'BODY.PEEK[]' in str(call) for call in box.calls))
    def test_truncated_message_is_not_imported_as_a_complete_reply(self):
        box=FakeIMAP('unused');original=box.uid
        def uid(command,*args):
            if command=='FETCH' and 'BODY.PEEK[]' in args[1]:return 'OK',[(b'body',box.source[:-10])]
            return original(command,*args)
        box.uid=uid
        with self.assertRaisesRegex(m.MailFailure,'^INBOUND_INVALID_RESPONSE$'):
            m.read_mail({'parents':PARENTS,'since':'2026-10-01'},lambda *args,**kwargs:box)
        self.assertTrue(box.logged_out)
    def test_login_error_is_safe_and_connection_closed(self):
        box=FakeIMAP('unused');box.auth_fail=True
        with self.assertRaisesRegex(m.MailFailure,'^INBOUND_LOGIN_FAILED$'):
            m.read_mail({'parents':PARENTS,'since':'2026-10-01'},lambda *args,**kwargs:box)
        self.assertTrue(box.logged_out)
    def test_uidvalidity_change_restarts_scan_and_batch_is_bounded(self):
        box=FakeIMAP('unused');uid=box.uid
        box.uid=lambda command,*args:('OK',[b' '.join(str(i).encode() for i in range(1,71))]) if command=='SEARCH' else uid(command,*args)
        result=m.read_mail({'parents':PARENTS,'since':'2026-10-01','cursor':999,'uidValidity':41},lambda *args,**kwargs:box)
        self.assertEqual(result['cursor'],50);self.assertTrue(result['pending']);self.assertEqual(result['scanned'],50)

if __name__=='__main__':unittest.main()
