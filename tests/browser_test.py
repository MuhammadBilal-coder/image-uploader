"""Optional browser integration tests: pip install playwright pillow; playwright install chromium."""
import io
import os
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from PIL import Image, ImageDraw
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass

def picture(fmt, colors):
    im = Image.new('RGB', (640, 420), colors[0]); d = ImageDraw.Draw(im)
    d.ellipse((405, 35, 505, 135), fill=colors[1])
    d.polygon([(0, 330), (180, 115), (390, 330)], fill=colors[2]); d.polygon([(150, 420), (445, 175), (640, 370), (640, 420)], fill=colors[3]); d.rectangle((0, 365, 640, 420), fill=colors[3]); b = io.BytesIO(); im.save(b, format=fmt); return b.getvalue()

def main():
    server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    url = f'http://127.0.0.1:{server.server_port}/'
    png = picture('PNG', ['#f4d3ad','#fff4ce','#bc7e80','#514b72'])
    jpg = picture('JPEG', ['#b7d9ee','#fbefc9','#648ba2','#2f5a72'])
    gif = picture('GIF', ['#c8e6d6','#f5edc6','#79a58b','#416d60'])
    with sync_playwright() as p:
        executable = os.environ.get('CHROMIUM_PATH')
        browser = p.chromium.launch(executable_path=executable, args=['--no-sandbox'] if executable else [])
        page = browser.new_page(viewport={'width': 1440, 'height': 950}); errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        offline = os.environ.get('OFFLINE_TEST') == '1'
        # Restricted environments can render the real HTML/CSS/JS without navigation.
        # The storage adapter below is only used in this mode, not in the application.
        def reload_app():
            nonlocal page
            if not offline:
                if page.url == 'about:blank': page.goto(url)
                else: page.reload()
                return
            saved = page.evaluate('window.__testStorage || {}')
            viewport = page.viewport_size
            page.close()
            page = browser.new_page(viewport=viewport)
            page.on('pageerror', lambda err: errors.append(str(err)))
            html = (ROOT/'index.html').read_text().replace('<link rel="stylesheet" href="style.css">', '<style>'+(ROOT/'style.css').read_text()+'</style>').replace('<script src="script.js" defer></script>', '').replace('<link rel="icon" href="assets/favicon.svg" type="image/svg+xml">','')
            page.set_content(html)
            page.evaluate("""saved => {window.__testStorage=saved; Object.defineProperty(window,'localStorage',{value:{getItem(k){return Object.hasOwn(saved,k)?saved[k]:null},setItem(k,v){saved[k]=String(v)},removeItem(k){delete saved[k]}}});}""", saved)
            page.add_script_tag(content=(ROOT/'script.js').read_text())
        reload_app(); expect(page.locator('#empty-gallery')).to_be_visible()
        # Browse files opens the native chooser, then selects PNG.
        with page.expect_file_chooser() as chooser: page.locator('#browse').click()
        chooser.value.set_files({'name':'desert-sunset.png','mimeType':'image/png','buffer':png})
        page.wait_for_function("""() => {const v=Number(document.querySelector('[role=progressbar]').getAttribute('aria-valuenow'));return v>0 && v<100;}""")
        expect(page.locator('#gallery-count')).to_have_text('1'); expect(page.locator('.queue-row.done .queue-percent')).to_have_text('100%')
        # Drag and drop JPEG through actual DOM events.
        page.evaluate("""bytes => {const z=document.querySelector('#drop-zone');const dt=new DataTransfer();dt.items.add(new File([new Uint8Array(bytes)],'mountain-lake.jpg',{type:'image/jpeg'}));for(const type of ['dragenter','dragover','drop']) z.dispatchEvent(new DragEvent(type,{dataTransfer:dt,bubbles:true,cancelable:true}));}""", list(jpg))
        expect(page.locator('#gallery-count')).to_have_text('2'); expect(page.locator('#drop-zone')).not_to_have_class('drop-zone is-dragging')
        page.locator('#file-input').set_input_files({'name':'forest-hills.gif','mimeType':'image/gif','buffer':gif}); expect(page.locator('#gallery-count')).to_have_text('3')
        page.screenshot(path=str(ROOT/'docs/desktop-preview.png'),full_page=True)
        reload_app(); expect(page.locator('#gallery-count')).to_have_text('3'); expect(page.locator('.image-card')).to_have_count(3)
        page.wait_for_function("[...document.querySelectorAll('.thumb-button img')].every(i=>i.complete && i.naturalWidth>0)")
        page.get_by_role('button',name='Preview desert-sunset.png').click(); expect(page.locator('#preview-dialog')).to_be_visible(); page.locator('#close-preview').click()
        page.set_viewport_size({'width':390,'height':844}); page.screenshot(path=str(ROOT/'docs/mobile-preview.png'),full_page=True)
        for width in [320,390,768,1440]:
            page.set_viewport_size({'width':width,'height':900}); assert page.evaluate('document.documentElement.scrollWidth <= innerWidth'), width
        page.locator('#file-input').set_input_files({'name':'notes.txt','mimeType':'text/plain','buffer':b'hello'}); expect(page.locator('#messages')).to_contain_text('Only JPG')
        page.locator('#file-input').set_input_files({'name':'fake.png','mimeType':'image/png','buffer':b'not a png'}); expect(page.locator('#messages')).to_contain_text('contents do not match')
        page.locator('#file-input').set_input_files({'name':'empty.gif','mimeType':'image/gif','buffer':b''}); expect(page.locator('#messages')).to_contain_text('empty')
        page.locator('#file-input').set_input_files({'name':'large.png','mimeType':'image/png','buffer':b'x'*(5*1024*1024+1)}); expect(page.locator('#messages')).to_contain_text('5 MB')
        page.get_by_role('button',name='Remove mountain-lake.jpg').click(); reload_app(); expect(page.locator('#gallery-count')).to_have_text('2')
        page.locator('#clear-all').click(); page.locator('#cancel-clear').click(); expect(page.locator('#gallery-count')).to_have_text('2')
        page.locator('#clear-all').click(); page.locator('#confirm-clear').click(); reload_app(); expect(page.locator('#gallery-count')).to_have_text('0')
        page.locator('#file-input').set_input_files([{'name':'one.png','mimeType':'image/png','buffer':png},{'name':'two.jpg','mimeType':'image/jpeg','buffer':jpg},{'name':'bad.txt','mimeType':'text/plain','buffer':b'hello'}]); expect(page.locator('#gallery-count')).to_have_text('2'); expect(page.locator('#messages')).to_contain_text('Only JPG'); reload_app(); expect(page.locator('#gallery-count')).to_have_text('2')
        page.locator('#clear-all').click(); page.locator('#confirm-clear').click(); expect(page.locator('#gallery-count')).to_have_text('0')
        # Simulate browser quota errors; the preview must survive for this session.
        if offline: page.evaluate("() => {localStorage.setItem = function(){throw new DOMException('Full','QuotaExceededError')}}")
        else: page.evaluate("() => {Storage.prototype.setItem = function(){throw new DOMException('Full','QuotaExceededError')}}")
        page.locator('#file-input').set_input_files({'name':'temporary.png','mimeType':'image/png','buffer':png}); expect(page.locator('#gallery-count')).to_have_text('1'); expect(page.locator('#messages')).to_contain_text('session only'); expect(page.locator('.image-size')).to_contain_text('Session only')
        reload_app(); expect(page.locator('#gallery-count')).to_have_text('0')
        page.evaluate("localStorage.setItem('dropzone.images.v1','{invalid')"); reload_app(); expect(page.locator('#messages')).to_contain_text('could not be read'); expect(page.locator('#gallery-count')).to_have_text('0')
        assert not errors, errors
        print('PASS: browse, drag/drop, multiple-file selection, PNG/JPEG/GIF, intermediate progress, preview, reload persistence, invalid/empty/oversized files, removal, clear confirmation, quota errors, corrupt storage, responsive widths, no uncaught errors.')
        browser.close()
    server.shutdown()

if __name__ == '__main__': main()
