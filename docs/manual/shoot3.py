import pathlib
from playwright.sync_api import sync_playwright
HERE=pathlib.Path(__file__).parent
src=pathlib.Path(r"C:/Users/fcori/Rthoptera Desktop/src/index.html").as_uri()
with sync_playwright() as p:
    b=p.chromium.launch(channel="chrome",headless=True)
    pg=b.new_page(viewport={"width":900,"height":900},device_scale_factor=2.2)
    pg.goto(src); pg.wait_for_timeout(1000)
    pg.set_input_files('#audioFile',str(HERE/'demo_song.wav')); pg.wait_for_timeout(2500)
    pg.evaluate("switchMainTab('envpeaks', document.getElementById('maintab-envpeaks'))"); pg.wait_for_timeout(600)
    pg.evaluate("pkDetect()"); pg.wait_for_timeout(2500)
    pg.evaluate("pkSelection.add(pkEnvPeaks[10]); pkSelection.add(pkEnvPeaks[11]); pkUpdateSelectionButtons(); pkUpdateSelUi(); pkDrawEnvelope()"); pg.wait_for_timeout(500)
    pg.locator('#pkEditStrip').screenshot(path=str(HERE/'shots'/'f05_strip.png'))
    b.close()
