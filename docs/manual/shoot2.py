import pathlib, traceback
from playwright.sync_api import sync_playwright
HERE=pathlib.Path(__file__).parent; S=HERE/'shots'
src=pathlib.Path(r"C:/Users/fcori/Rthoptera Desktop/src/index.html").as_uri()
def step(name):
    def deco(f):
        try: f(); print('ok',name)
        except Exception as e: print('FAIL',name,str(e)[:200])
    return deco
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome",headless=True)
    pg=b.new_page(viewport={"width":1500,"height":950},device_scale_factor=1.25)
    errs=[]; pg.on("pageerror",lambda e:errs.append(str(e)[:150]))
    pg.goto(src); pg.wait_for_timeout(1200)
    pg.screenshot(path=str(S/'f00_landing.png'))
    pg.set_input_files('#audioFile',str(HERE/'demo_song.wav')); pg.wait_for_timeout(2500)
    @step('metadata')
    def _():
        pg.evaluate("openRecordingMeta()"); pg.wait_for_timeout(500)
        for i,v in [('countryInput','Demo'),('localityInput','Synthetic test recording'),('tempCInput','22.5'),('specimenIdInput','DEMO-01'),('speciesInput','Demo katydid')]:
            pg.fill('#'+i,v)
        pg.wait_for_timeout(300)
        pg.locator('#recMetaOverlay .modal-box').screenshot(path=str(S/'f02_metadata.png'))
        pg.evaluate("closeRecordingMeta()")
    @step('preprocess+pane')
    def _():
        pg.evaluate("applyLibWidth(260)"); pg.wait_for_timeout(600)
        pg.screenshot(path=str(S/'f01_window.png'))
        pg.evaluate("applyLibWidth(0)"); pg.wait_for_timeout(400)
        pg.screenshot(path=str(S/'f03_edit_audio.png'))
    @step('temporal')
    def _():
        pg.evaluate("switchMainTab('envpeaks', document.getElementById('maintab-envpeaks'))"); pg.wait_for_timeout(800)
        pg.screenshot(path=str(S/'f04a_temporal_empty.png'))
        pg.evaluate("pkDetect()"); pg.wait_for_timeout(2500)
        pg.screenshot(path=str(S/'f04_temporal.png'))
        r=pg.locator('#pkEditStrip').bounding_box(); print(r)
        pg.locator('#pkEditStrip').screenshot(path=str(S/'f05_strip.png'))
    @step('temporal metrics')
    def _():
        pg.evaluate("pkConfirm()"); pg.wait_for_timeout(2500)
        pg.evaluate("document.getElementById('pkTable').scrollIntoView({block:'end'})"); pg.wait_for_timeout(500)
        pg.screenshot(path=str(S/'f06_temporal_tables.png'))
    @step('temporal selections')
    def _():
        pg.evaluate("pkRunAmpDetector()"); pg.wait_for_timeout(2000)
        pg.evaluate("[...document.querySelectorAll('.row-collapse-bar')].find(b=>/Selections\s*$/.test(b.textContent.trim())).querySelector('button').click()"); pg.wait_for_timeout(600)
        pg.evaluate("document.querySelector('[data-collapse-row=Selections]').scrollIntoView({block:'end'})"); pg.wait_for_timeout(600)
        pg.screenshot(path=str(S/'f06b_temporal_selections.png'))
    @step('spectral')
    def _():
        pg.evaluate("switchMainTab('analyzer', document.getElementById('maintab-analyzer'))"); pg.wait_for_timeout(1500)
        pg.screenshot(path=str(S/'f07_spectral.png'))
    @step('annotate')
    def _():
        pg.evaluate("switchMainTab('annotate', document.getElementById('maintab-annotate'))"); pg.wait_for_timeout(1500)
        pg.screenshot(path=str(S/'f08_annotate.png'))
    @step('plotting')
    def _():
        pg.evaluate("switchMainTab('plotting', document.getElementById('maintab-plotting'))"); pg.wait_for_timeout(1500)
        pg.get_by_role('button', name='Render').first.click(); pg.wait_for_timeout(3000)
        pg.screenshot(path=str(S/'f09_plotting.png'))
    @step('summarize')
    def _():
        pg.evaluate("switchMainTab('summarize', document.getElementById('maintab-summarize'))"); pg.wait_for_timeout(1000)
        pg.screenshot(path=str(S/'f10_summarize.png'))
    @step('workflow')
    def _():
        pg.evaluate("switchMainTab('workflow', document.getElementById('maintab-workflow'))"); pg.wait_for_timeout(1000)
        pg.screenshot(path=str(S/'f11_workflow.png'))
    @step('cluster')
    def _():
        pg.evaluate("switchMainTab('cluster', document.getElementById('maintab-cluster'))"); pg.wait_for_timeout(1000)
        pg.screenshot(path=str(S/'f12_cluster.png'))
    @step('str')
    def _():
        pg.evaluate("switchMainTab('str', document.getElementById('maintab-str'))"); pg.wait_for_timeout(1000)
        pg.evaluate("document.querySelector('#libSide') && 0")
        pg.evaluate("strRun()"); pg.wait_for_timeout(4000)
        pg.set_viewport_size({"width":1500,"height":1420}); pg.wait_for_timeout(1500)
        pg.screenshot(path=str(S/'f13_str.png'))
    print(errs[:6])
    b.close()
