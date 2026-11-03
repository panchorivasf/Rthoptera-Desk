import re, subprocess, sys, os, html
HERE = os.path.dirname(os.path.abspath(__file__))
body = open(os.path.join(HERE,'body.html'),encoding='utf-8').read()
CHROME = r"C:\Program Files\Google\Chrome\Application\chrome.exe"
OUT = os.path.join(HERE,'..','..','Rthoptera_Desk_User_Manual_v0.9.0.pdf')

css = """
:root{--teal:#156082;--dark:#0c3347;--mid:#0e75a0;--pale:#e8f1f5;--line:#c9d8e0;--txt:#1b2a33;--muted:#5b6b75}
@page{size:A4;margin:24mm 20mm 24mm 20mm;
 @top-right{content:"Rthoptera Desk 0.9.0 — User Manual";font:8pt 'Segoe UI',Arial,sans-serif;color:#7a8a94;padding-bottom:4mm;border-bottom:.4pt solid #c9d8e0;width:100%;text-align:right}
 @bottom-center{content:counter(page);font:9pt 'Segoe UI',Arial,sans-serif;color:#5b6b75}}
@page :first{margin:0;@top-right{content:none;border:0}@bottom-center{content:none}}
@page toc{@top-right{content:"Rthoptera Desk 0.9.0 — User Manual"}}
*{box-sizing:border-box}
html{font-size:10pt}
body{font-family:'Segoe UI','Helvetica Neue',Arial,sans-serif;color:var(--txt);line-height:1.5;margin:0;orphans:3;widows:3}
.cover{height:297mm;width:210mm;background:var(--dark);color:#fff;position:relative;page-break-after:always;overflow:hidden}
.cover .band{position:absolute;left:0;right:0;bottom:0;height:62mm;background:var(--teal)}
.cover img{position:absolute;left:50%;top:44mm;width:92mm;height:92mm;margin-left:-46mm}
.cover h1{position:absolute;top:150mm;left:0;right:0;text-align:center;font-size:34pt;font-weight:300;letter-spacing:.5pt;margin:0;border:0;color:#fff;padding:0}
.cover h1 b{font-weight:700;color:#fff}
.cover .sub{position:absolute;top:172mm;left:0;right:0;text-align:center;font-size:15pt;letter-spacing:3pt;text-transform:uppercase;color:#9fd3e8}
.cover .tag2{position:absolute;top:186mm;left:30mm;right:30mm;text-align:center;font-size:11.5pt;color:#d7e8f0}
.cover .ver{position:absolute;bottom:34mm;left:0;right:0;text-align:center;font-size:12pt;color:#fff;letter-spacing:1pt}
.cover .fine{position:absolute;bottom:18mm;left:25mm;right:25mm;text-align:center;font-size:8.5pt;color:#cfe3ec}
h1{font-size:20pt;color:var(--dark);margin:0 0 6mm;padding:0 0 2.5mm;border-bottom:2.2pt solid var(--teal);page-break-before:always;break-after:avoid;font-weight:600}
h1.first{page-break-before:avoid}
h2{font-size:13.5pt;color:var(--teal);margin:7mm 0 2.5mm;break-after:avoid;font-weight:600}
h3{font-size:11pt;color:var(--dark);margin:5mm 0 1.5mm;break-after:avoid;font-weight:600}
p{margin:0 0 2.6mm}
ul,ol{margin:0 0 3mm;padding-left:6mm}
li{margin:0 0 1.2mm}
li>ul,li>ol{margin:1.2mm 0 1mm}
b{font-weight:600;color:#12313f}
code{font-family:Consolas,'Cascadia Mono',monospace;font-size:8.8pt;background:#eef3f6;border:.4pt solid #d5e0e6;border-radius:2pt;padding:0 2pt;color:#0b4a66;word-break:break-word}
.tag{font-size:8pt;vertical-align:middle;background:var(--mid);color:#fff;border-radius:3pt;padding:1pt 5pt;margin-left:4pt;letter-spacing:.5pt;font-weight:600}
table{width:100%;border-collapse:collapse;margin:2mm 0 4mm;font-size:9pt;break-inside:auto}
tr{break-inside:avoid}
th{background:var(--teal);color:#fff;text-align:left;padding:1.6mm 2.4mm;font-weight:600;font-size:8.8pt}
td{padding:1.5mm 2.4mm;border-bottom:.4pt solid var(--line);vertical-align:top}
tbody tr:nth-child(even) td,table:not(.plain) tr:nth-child(even) td{background:#f6fafc}
td.subhead{background:var(--pale)!important;color:var(--dark);font-weight:600;font-size:8.8pt;letter-spacing:.3pt}
table.plain td{border-bottom:.4pt solid var(--line)}
table.plain td:first-child{width:28%;white-space:nowrap}
table.plain tr:nth-child(even) td{background:none}
.note,.warn,.prov{margin:3mm 0 4mm;padding:2.6mm 3.6mm;border-left:3pt solid var(--mid);background:#eaf4f9;border-radius:0 3pt 3pt 0;font-size:9.4pt;break-inside:avoid}
.warn{border-left-color:#c0602a;background:#fdf1e8}
.prov{border-left-color:#8a6fb0;background:#f3eff8}
.cite{margin-left:6mm;padding-left:3mm;border-left:1.5pt solid var(--line);color:#33454f;font-size:9.4pt}
figure{margin:3mm 0 5mm;break-inside:avoid;text-align:center}
figure img{width:100%;border:.6pt solid #b9c9d2;border-radius:2pt;display:block}
figure.narrow img{width:62%;margin:0 auto}
figcaption{font-size:8.8pt;color:#44565f;margin-top:1.8mm;text-align:left;line-height:1.4}
figcaption b{color:var(--teal)}
/* TOC */
.toc{page:toc}
.toc h1{page-break-before:auto;margin-bottom:5mm}
.toc .row{display:flex;align-items:baseline;font-size:10pt;margin:0}
.toc .row .t{flex:0 1 auto}
.toc .row .d{flex:1 1 auto;border-bottom:.8pt dotted #9bb1bd;margin:0 2mm;transform:translateY(-2pt);min-width:6mm}
.toc .row .n{flex:0 0 auto;font-variant-numeric:tabular-nums;color:var(--muted)}
.toc .l1{font-weight:600;color:var(--dark);margin-top:2.2mm;font-size:10.4pt}
.toc .l2{padding-left:7mm;font-size:9pt;color:#33454f;line-height:1.38}
"""

# --- number the figures
SHORT={'f01_window':'The main window','f02_metadata':'Recording metadata window','f03_edit_audio':'Preprocessing: Edit audio','f04_temporal':'Temporal Analysis after peak detection','f05_strip':'The editing strip','f06b_temporal_selections':'Results tables and the Selections box','f07_spectral':'Spectral Analysis','f08_annotate':'Annotate','f09_plotting':'Plotting: Multiplot','f10_summarize':'Summarize: Summary sub-tab','f11_workflow':'Custom Workflow tab','f12_cluster':'Clustering tab','f13_str':'STR after computing'}
figs=[]
def _num(m):
    n=len(figs)+1; name=m.group(1)
    figs.append((n,SHORT[name]))
    return m.group(0).replace('<figcaption>','<figcaption><b>Figure %d.</b> '%n)
body=re.sub(r'<img src="shots/final/([^"]+)\.png"[^>]*><figcaption>',_num,body)
# --- collect headings for the TOC
heads = re.findall(r'<h([12]) id="([^"]+)">(.*?)</h\1>', body, flags=re.S)
def clean(t): return html.unescape(re.sub(r'<[^>]+>','',t)).strip()
entries = [(int(l), i, clean(t)) for l,i,t in heads]

def toc_html(pages):
    out = ['<div class="toc"><h1 class="first" style="page-break-before:avoid">Contents</h1>']
    for lvl,i,t in entries:
        if lvl==2 and not re.match(r'^\d+\.\d+ ', t) : continue
        n = pages.get(i,'')
        out.append(f'<div class="row l{lvl}"><span class="t">{html.escape(re.sub(r'\s*NEW$','',t))}</span><span class="d"></span><span class="n">{n}</span></div>')
    out.append('<h2 style="margin-top:9mm;break-after:avoid">List of figures</h2>')
    for n,t in figs:
        pn=pages.get('fig%d'%n,'')
        out.append(f'<div class="row l2"><span class="t">Figure {n}. {html.escape(t)}</span><span class="d"></span><span class="n">{pn}</span></div>')
    out.append('</div>')
    return '\n'.join(out)

cover = """<div class="cover"><div class="band"></div><img src="logo.png">
<h1><b>Rthoptera</b> Desk</h1><div class="sub">User Manual</div>
<div class="tag2">Desktop application for insect bioacoustics analysis</div>
<div class="ver">Version 0.9.0 &nbsp;&middot;&nbsp; November 2026</div>
<div class="fine">Provisional edition for colleagues&rsquo; testing and feedback. Not for citation or redistribution.<br>Rthoptera Desk project &nbsp;&middot;&nbsp; github.com/panchorivasf/Rthoptera-Desk</div></div>"""

def page(pages):
    return f"<!doctype html><html lang='en'><head><meta charset='utf-8'><title>Rthoptera Desk 0.9.0 — User Manual</title><style>{css}</style></head><body>{cover}{toc_html(pages)}{body}</body></html>"

def render(pages):
    p = os.path.join(HERE,'manual.html')
    open(p,'w',encoding='utf-8').write(page(pages))
    subprocess.run([CHROME,'--headless=new','--disable-gpu','--no-pdf-header-footer','--allow-file-access-from-files',
        f'--print-to-pdf={OUT}',__import__('pathlib').Path(p).as_uri()],check=True,capture_output=True,timeout=180)

def page_map():
    txt = subprocess.run(['pdftotext','-enc','UTF-8','-layout',OUT,'-'],capture_output=True).stdout.decode('utf-8','replace')
    pgs = txt.split('\f')
    cutoff = next(n for n,pg in enumerate(pgs,1) if 'is a cross-platform desktop application' in pg)-1
    res = {}
    for lvl,i,t in entries:
        key = re.sub(r'\s+',' ',t)
        for n,pg in enumerate(pgs, start=1):
            if n<=cutoff: continue   # cover and contents pages
            flat = re.sub(r'[ \t]+',' ',pg)
            if any(line.strip().startswith(key[:38]) for line in flat.split('\n')):
                res[i]=n; break
    for n,t in figs:
        for k,pg in enumerate(pgs,start=1):
            if k<=cutoff: continue
            if re.search(r'^\s*Figure %d\.'%n,pg,re.M): res['fig%d'%n]=k; break
    return res

render({})
# contents may take 2 pages: find first page after contents that holds chapter 1
pm = page_map(); render(pm)
pm2 = page_map()
if pm2!=pm: render(pm2); pm2 = page_map()
print(len(entries), 'headings;', len(pm2), 'located')
missing=[t for l,i,t in entries if i not in pm2 and (l==1 or re.match(r'^\d+\.\d+ ',t))]
print('missing:', missing)
