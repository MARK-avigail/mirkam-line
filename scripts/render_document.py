"""Render A4 Hebrew petitions; JSON input on stdin, PDF bytes on stdout."""
import ctypes, ctypes.util, io, json, os, re, sys
from pathlib import Path
def env(name): return os.environ.get(name, '')
from functools import lru_cache

@lru_cache(maxsize=1)
def rtl_converter():
    try:
        from bidi.algorithm import get_display
        return lambda text: get_display(text, base_dir='R')
    except ImportError:
        lib=ctypes.CDLL(ctypes.util.find_library('fribidi'))
        lib.fribidi_log2vis.argtypes=[ctypes.POINTER(ctypes.c_uint32),ctypes.c_int,ctypes.POINTER(ctypes.c_uint32),ctypes.POINTER(ctypes.c_uint32),ctypes.c_void_p,ctypes.c_void_p,ctypes.c_void_p]
        def convert(text):
            n=len(text); inp=(ctypes.c_uint32*n)(*map(ord,text)); out=(ctypes.c_uint32*n)()
            direction=ctypes.c_uint32(0x111)
            if not lib.fribidi_log2vis(inp,n,ctypes.byref(direction),out,None,None,None): raise RuntimeError('RTL conversion failed')
            return ''.join(map(chr,out))
        return convert

def visual(text): return rtl_converter()(text)

def pdf(document, test=False):
    from reportlab.pdfgen.canvas import Canvas
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib.pagesizes import A4
    font=env('HEBREW_FONT') or '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf'
    if 'Hebrew' not in pdfmetrics.getRegisteredFontNames(): pdfmetrics.registerFont(TTFont('Hebrew',font))
    bold=env('HEBREW_FONT_BOLD') or str(Path(font).with_name(Path(font).stem+'-Bold.ttf'))
    if Path(bold).is_file() and 'HebrewBold' not in pdfmetrics.getRegisteredFontNames():
        pdfmetrics.registerFont(TTFont('HebrewBold',bold))
    bold_name='HebrewBold' if 'HebrewBold' in pdfmetrics.getRegisteredFontNames() else 'Hebrew'
    buf=io.BytesIO(); c=Canvas(buf,pagesize=A4); c.setTitle('מסמך מהודעה קולית')
    width,height=A4; y=height-65
    def header():
        if test:
            c.setFont(bold_name,10); c.setFillColorRGB(.35,.35,.35)
            c.drawCentredString(width/2,height-30,visual('בדיקת מערכת — לא להגשה'))
            c.setFillColorRGB(0,0,0)
    def footer():
        c.setFont('Hebrew',9); c.drawCentredString(width/2,30,str(c.getPageNumber()))
    header()
    for paragraph in document.splitlines():
        heading=bool(re.match(r'^\d+\. ',paragraph))
        title=paragraph in ('עתירה','נגד')
        size=16 if paragraph=='עתירה' else 12
        current_font=bold_name if heading or title or paragraph.startswith(('בית המשפט','בית משפט','בבית','נושא:')) else 'Hebrew'
        if heading and y<110:
            footer(); c.showPage(); header(); y=height-65
        c.setFont(current_font,size)
        lines=[]; line=''
        for word in paragraph.split():
            if pdfmetrics.stringWidth(visual(word),current_font,size)>width-100:
                chunks=[]; chunk=''
                for char in word:
                    if pdfmetrics.stringWidth(visual(chunk+char),current_font,size)>width-100:
                        chunks.append(chunk); chunk=''
                    chunk+=char
                chunks.append(chunk)
            else: chunks=[word]
            for chunk in chunks:
                candidate=(line+' '+chunk).strip()
                if line and pdfmetrics.stringWidth(visual(candidate),current_font,size)>width-100:
                    lines.append(line); line=chunk
                else: line=candidate
        lines.append(line)
        for line in lines:
            if y<55:
                footer(); c.showPage(); header(); c.setFont(current_font,size); y=height-65
            if title: c.drawCentredString(width/2,y,visual(line))
            else: c.drawRightString(width-50,y,visual(line))
            y-=22 if paragraph=='עתירה' else 18
        y-=5
    footer()
    c.save(); return buf.getvalue()

if __name__ == '__main__':
    try:
        raw=sys.stdin.buffer.read(700001)
        if len(raw)>700000: raise ValueError('Input too large')
        payload=json.loads(raw)
        document=payload['document']
        if not isinstance(document,str) or len(document)>100000: raise ValueError('Invalid document')
        sys.stdout.buffer.write(pdf(document, bool(payload.get('test',True))))
    except Exception:
        sys.stderr.write('PDF rendering failed: check Python dependencies and Hebrew font configuration.\n')
        sys.exit(1)
