"""Build the offline guide from our deliberately small Markdown subset."""
from pathlib import Path
import html
import re

ROOT = Path(__file__).resolve().parents[1]

def slug(text):
    return re.sub(r'[^a-z0-9]+', '-', text.lower()).strip('-')

def inline(text):
    text=html.escape(text)
    text=re.sub(r'`([^`]+)`',r'<code>\1</code>',text)
    text=re.sub(r'\*\*([^*]+)\*\*',r'<strong>\1</strong>',text)
    return text

def render(text):
    lines=text.splitlines();out=[];toc=[];i=0
    while i<len(lines):
        line=lines[i]
        if not line.strip():i+=1;continue
        if line.startswith('```'):
            i+=1;block=[]
            while i<len(lines) and not lines[i].startswith('```'):
                block.append(lines[i]);i+=1
            out.append('<pre><code>'+html.escape('\n'.join(block))+'</code></pre>');i+=1;continue
        if line.startswith('#'):
            m=re.fullmatch(r'(#{1,3}) (.+)',line)
            if not m:raise ValueError('Unsupported heading: '+line)
            level=len(m[1]);title=m[2];ident=slug(title)
            if level==2:toc.append((ident,title))
            out.append(f'<h{level} id="{ident}">{inline(title)}</h{level}>');i+=1;continue
        if line.startswith('|'):
            rows=[]
            while i<len(lines) and lines[i].startswith('|'):
                cells=[x.strip() for x in lines[i].strip('|').split('|')]
                if not all(re.fullmatch(r':?-+:?',c) for c in cells):rows.append(cells)
                i+=1
            table='<div class="table-scroll"><table><thead><tr>'+''.join('<th scope="col">'+inline(c)+'</th>' for c in rows[0])+'</tr></thead><tbody>'
            table+=''.join('<tr>'+''.join('<td>'+inline(c)+'</td>' for c in row)+'</tr>' for row in rows[1:])
            out.append(table+'</tbody></table></div>');continue
        if re.match(r'^(?:- |\d+\. )',line):
            numbered=bool(re.match(r'^\d+\. ',line));tag='ol' if numbered else 'ul';items=[]
            pattern=r'^\d+\. (.*)' if numbered else r'^- (.*)'
            while i<len(lines) and (m:=re.match(pattern,lines[i])):
                items.append('<li>'+inline(m[1])+'</li>');i+=1
            out.append('<'+tag+'>'+''.join(items)+'</'+tag+'>');continue
        paragraph=[line];i+=1
        while i<len(lines) and lines[i].strip() and not re.match(r'^(?:#|\||```|- |\d+\. )',lines[i]):
            paragraph.append(lines[i]);i+=1
        out.append('<p>'+inline(' '.join(paragraph))+'</p>')
    return '\n'.join(out),toc

CSS='''
:root{color-scheme:light;--ink:#16332d;--muted:#53665f;--line:#d6e2dc;--paper:#fff;--accent:#236b54}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:25px}body{margin:0;background:#f2f6f3;color:var(--ink);font:17px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{padding:24px 36px;background:#183c32;color:#fff}header strong{font-size:24px}header p{margin:4px 0 0;color:#cce1d6}
.layout{display:grid;grid-template-columns:280px minmax(0,920px);gap:36px;max-width:1320px;margin:32px auto;padding:0 28px}
nav{position:sticky;top:24px;align-self:start;max-height:94vh;overflow:auto;font-size:14px;padding:20px;background:#e7f0ea;border-radius:12px}nav strong{display:block;margin-bottom:10px}nav a{display:block;padding:6px 0;line-height:1.4}
main{background:var(--paper);padding:36px 44px;border:1px solid var(--line);border-radius:12px;min-width:0}h1{font-size:34px;line-height:1.2;margin:0 0 14px}h2{font-size:26px;line-height:1.3;margin:48px 0 14px;padding-top:24px;border-top:1px solid var(--line)}h3{font-size:20px;margin:30px 0 12px}p{margin:14px 0}a{color:var(--accent);text-underline-offset:3px}a:focus-visible{outline:3px solid #b78132;outline-offset:3px}li{margin:10px 0}strong{font-weight:650}
.table-scroll{overflow-x:auto;margin:20px 0}table{width:100%;border-collapse:collapse;font-size:15px;line-height:1.5}th,td{text-align:left;vertical-align:top;padding:12px;border-bottom:1px solid var(--line)}th{background:#e7f0ea}tbody tr:nth-child(even){background:#f7faf8}
pre{overflow-x:auto;background:#edf3f0;border:1px solid var(--line);border-left:4px solid #54836a;border-radius:5px;padding:20px;font:14px/1.8 ui-monospace,monospace}code{font-family:ui-monospace,monospace;font-size:.9em}footer{color:var(--muted);font-size:14px;margin:40px 0 0;border-top:1px solid var(--line);padding-top:20px}.hint{background:#f5eedc;padding:14px 20px;border-radius:8px;font-size:15px}
@media(max-width:850px){.layout{display:block;padding:0 16px;margin-top:18px}nav{position:static;max-height:none;margin-bottom:20px}main{padding:24px}header{padding:20px}h1{font-size:28px}}
@media print{body{background:white;font-size:11pt}header,nav,.hint{display:none}.layout{display:block;margin:0;padding:0;max-width:none}main{border:0;padding:0}h2{break-after:avoid}h3{break-after:avoid}tr{break-inside:avoid}table{font-size:10pt}a{color:inherit}}
'''

def build():
    body,toc=render((ROOT/'docs/USER_GUIDE.md').read_text())
    links=''.join(f'<a href="#{ident}">{html.escape(title)}</a>' for ident,title in toc)
    page='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cashflow Builder · User guide</title><style>'+CSS+'</style></head><body>'
    page+='<header><strong>Cashflow Builder</strong><p>Work dates, payment timing and keeping your plan up to date.</p></header><div class="layout"><nav aria-label="Guide contents"><strong>In this guide</strong>'+links+'</nav><main>'
    page+='<p class="hint">This guide works offline. Keep it beside your project while planning. Use your browser’s Find to look up a term, or Print to save a PDF.</p>'+body
    page+='<footer>Cashflow Builder · Instructions included with the application. No project information is loaded by this page.</footer></main></div></body></html>'
    (ROOT/'app/help.html').write_text(page)
    print('Built app/help.html from docs/USER_GUIDE.md')

if __name__=='__main__':build()
