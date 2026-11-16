(() => {
'use strict';

/* ---------- helpers ---------- */
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const MAX = 150 * 1024 * 1024;
const MIME = { html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript', mjs: 'text/javascript', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', mp4: 'video/mp4', webm: 'video/webm', mp3: 'audio/mpeg', txt: 'text/plain', md: 'text/markdown', xml: 'application/xml' };
const TEXT = /\.(html?|css|m?js|json|svg|txt|md|xml)$/i;
const JKW = /(^|\.)(abstract|boolean|break|byte|case|catch|char|class|const|continue|default|do|double|else|enum|extends|final|finally|float|for|goto|if|implements|import|instanceof|int|interface|long|native|new|package|private|protected|public|return|short|static|super|switch|synchronized|this|throw|throws|try|void|volatile|while|true|false|null)(\.|$)/;
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cs = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
const fmt = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB';
const mimeOf = p => MIME[p.split('.').pop().toLowerCase()] || 'application/octet-stream';
const dirOf = p => p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '';
const slug = s => (s || 'project').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'project';
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fail = m => { throw new Error(m); };
const size = p => Object.values(p.files).reduce((a, b) => a + b.size, 0);
const encEntry = e => e.split('/').map(encodeURIComponent).join('/');
const zipLib = () => window.JSZip || fail('The ZIP library did not load. Check your connection and reload.');
const csName = n => { const s = String(n).replace(/[^A-Za-z0-9]/g, '') || 'HtmlApp'; return /^\d/.test(s) ? 'App' + s : s; };

const state = { projects: [], id: localStorage.getItem('hs.current'), path: null, dirty: false };
const current = () => state.projects.find(p => p.id === state.id) || null;
const need = () => current() || fail('Import a project first.');
function setCurrent(id) { state.id = id; id ? localStorage.setItem('hs.current', id) : localStorage.removeItem('hs.current'); }
const say = (el, msg, bad) => { el.textContent = msg; el.className = 'status' + (bad ? ' bad' : ''); };
function toast(msg, bad) {
  const t = $('#toast'); t.textContent = msg; t.className = 'toast show' + (bad ? ' bad' : '');
  clearTimeout(toast.t); toast.t = setTimeout(() => (t.className = 'toast'), 3500);
}
const guard = fn => async (...a) => { try { await fn(...a); } catch (e) { console.error(e); toast(e.message || String(e), true); } };
function download(blob, name) {
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 30000);
}
const go = v => { location.hash = v; route(); };

/* ---------- storage (IndexedDB, local only) ---------- */
const DB = (() => {
  let db;
  const open = () => db ||= new Promise((ok, no) => {
    const r = indexedDB.open('html-studio', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('projects', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result);
    r.onerror = () => no(r.error);
  });
  const run = async (mode, fn) => {
    const d = await open();
    return new Promise((ok, no) => {
      const t = d.transaction('projects', mode);
      const q = fn(t.objectStore('projects'));
      t.oncomplete = () => ok(q.result);
      t.onerror = t.onabort = () => no(t.error);
    });
  };
  return {
    all: () => run('readonly', s => s.getAll()),
    put: p => run('readwrite', s => s.put(p)),
    del: id => run('readwrite', s => s.delete(id))
  };
})();

async function loadProjects() {
  state.projects = (await DB.all()).sort((a, b) => b.updated - a.updated);
  if (!current() && state.projects.length) setCurrent(state.projects[0].id);
  renderAll();
}

/* ---------- import and validation ---------- */
function stripRoot(files) {
  const keys = Object.keys(files);
  const roots = new Set(keys.map(k => (k.includes('/') ? k.split('/')[0] : '')));
  if (roots.size !== 1 || roots.has('')) return files;
  const r = [...roots][0], out = {};
  for (const k of keys) out[k.slice(r.length + 1)] = files[k];
  return out;
}

async function readZip(file) {
  const J = zipLib();
  const zip = await J.loadAsync(file);
  const files = {};
  let total = 0;
  for (const [raw, e] of Object.entries(zip.files)) {
    const path = raw.replace(/\\/g, '/');
    if (e.dir || path.startsWith('__MACOSX/') || /(^|\/)\.DS_Store$/.test(path)) continue;
    if (path.startsWith('/') || path.split('/').includes('..')) fail('Unsafe path in ZIP: ' + path);
    const b = await e.async('blob');
    total += b.size;
    if (total > MAX) fail('The ZIP expands beyond 150 MB.');
    files[path] = new Blob([b], { type: mimeOf(path) });
  }
  if (!Object.keys(files).length) fail('The ZIP has no files.');
  return stripRoot(files);
}

function findEntry(files) {
  const htmls = Object.keys(files).filter(k => /\.html?$/i.test(k))
    .sort((a, b) => a.split('/').length - b.split('/').length || a.length - b.length);
  return htmls.find(k => /(^|\/)index\.html?$/i.test(k)) || htmls[0] || null;
}

async function ingest(file) {
  if (!file) fail('No file selected.');
  if (file.size > MAX) fail('This file is larger than 150 MB.');
  let files;
  if (/\.zip$/i.test(file.name)) files = await readZip(file);
  else if (/\.html?$/i.test(file.name)) {
    const txt = await file.text();
    if (txt.includes('\u0000') || !/<\s*(!doctype|html|body|head|div|p|h1|script|style)\b/i.test(txt)) fail('This does not look like an HTML file.');
    files = { [file.name]: new Blob([txt], { type: 'text/html' }) };
  } else fail('Choose an .html file or a website .zip.');
  const entry = findEntry(files) || fail('No .html page was found in this project.');
  const now = Date.now();
  const p = { id: uid(), name: file.name.replace(/\.(zip|html?)$/i, ''), entry, created: now, updated: now, files };
  await DB.put(p);
  return p;
}

async function sourceFor(inputSel) {
  const input = $(inputSel), f = input.files[0];
  if (!f) return need();
  const p = await ingest(f);
  input.value = '';
  setCurrent(p.id);
  await loadProjects();
  return p;
}

/* ---------- live preview: inline CSS, JS and images so the page works without a server ---------- */
const resolve = (base, ref) => {
  if (!ref || /^([a-z][a-z0-9+.-]*:|\/\/|#)/i.test(ref)) return null;
  try { return decodeURIComponent(new URL(ref.split(/[?#]/)[0], 'http://p.local/' + base).pathname.slice(1)); }
  catch { return null; }
};
const toUrl = b => new Promise((ok, no) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => no(r.error);
  r.readAsDataURL(b);
});
async function inlineCss(css, base, f) {
  const re = /url\(\s*(['"]?)([^'")]+?)\1\s*\)/g;
  let out = '', last = 0, m;
  while ((m = re.exec(css))) {
    const p = resolve(base, m[2].trim());
    out += css.slice(last, m.index) + (p && f[p] ? `url("${await toUrl(f[p])}")` : m[0]);
    last = re.lastIndex;
  }
  return out + css.slice(last);
}
async function buildHtml(p) {
  const f = p.files, base = dirOf(p.entry);
  const doc = new DOMParser().parseFromString(await f[p.entry].text(), 'text/html');
  for (const s of doc.querySelectorAll('style')) s.textContent = await inlineCss(s.textContent, base, f);
  for (const el of doc.querySelectorAll('[style]')) el.setAttribute('style', await inlineCss(el.getAttribute('style'), base, f));
  for (const el of doc.querySelectorAll('link[rel~="stylesheet"][href]')) {
    const path = resolve(base, el.getAttribute('href'));
    if (path && f[path]) {
      const s = doc.createElement('style');
      s.textContent = await inlineCss(await f[path].text(), dirOf(path), f);
      el.replaceWith(s);
    }
  }
  for (const el of doc.querySelectorAll('script[src]')) {
    const path = resolve(base, el.getAttribute('src'));
    if (path && f[path]) {
      const s = doc.createElement('script');
      if (el.type) s.type = el.type;
      s.textContent = (await f[path].text()).replace(/<\/script/gi, '<\\/script');
      el.replaceWith(s);
    }
  }
  for (const el of doc.querySelectorAll('img, source, video, audio')) {
    for (const a of ['src', 'poster']) {
      const path = resolve(base, el.getAttribute(a));
      if (path && f[path]) el.setAttribute(a, await toUrl(f[path]));
    }
  }
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}
const PLACEHOLDER = '<body style="margin:0;display:grid;place-items:center;height:100vh;font:16px system-ui;background:#151310;color:#958c7a">Import a project to preview it here.</body>';
async function renderPreview() {
  const p = current(), frame = $('#pv-frame');
  if (!p) { frame.srcdoc = PLACEHOLDER; $('#pv-source').textContent = ''; return; }
  frame.srcdoc = await buildHtml(p);
  $('#pv-source').textContent = await p.files[p.entry].text();
}

/* ---------- editor ---------- */
async function renderEditor() {
  const p = current(), sel = $('#ed-file');
  if (!p) { sel.innerHTML = ''; $('#ed-text').value = ''; say($('#ed-status'), 'Import a project to edit it.'); return; }
  sel.innerHTML = Object.keys(p.files).filter(f => TEXT.test(f)).sort().map(f => `<option>${esc(f)}</option>`).join('');
  sel.value = p.entry;
  await loadFile();
}
async function loadFile() {
  const p = current(), path = $('#ed-file').value;
  if (!p || !path) return;
  state.path = path; state.dirty = false;
  $('#ed-text').value = await p.files[path].text();
  say($('#ed-status'), `Editing ${path}. Press Ctrl+S or Save changes to keep your edits.`);
}
async function saveFile() {
  const p = need(), path = state.path || fail('Choose a file to edit.');
  p.files[path] = new Blob([$('#ed-text').value], { type: mimeOf(path) });
  p.updated = Date.now();
  await DB.put(p);
  state.dirty = false;
  say($('#ed-status'), `Saved ${path}.`);
  toast('Changes saved.');
}

/* ---------- exports ---------- */
async function exportZip(p) {
  const z = new (zipLib())();
  for (const [path, b] of Object.entries(p.files)) z.file(path, b);
  download(await z.generateAsync({ type: 'blob' }), slug(p.name) + '.zip');
}
async function exportHtml(p) {
  download(new Blob([await buildHtml(p)], { type: 'text/html' }), slug(p.name) + '.html');
}
async function pagesBundle(p) {
  const z = new (zipLib())();
  for (const [path, b] of Object.entries(p.files)) z.file(path, b);
  if (!p.files['index.html'] && p.entry !== 'index.html') {
    const u = esc(encEntry(p.entry));
    z.file('index.html', `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${u}"><title>${esc(p.name)}</title><a href="${u}">Open ${esc(p.name)}</a>`);
  }
  z.file('.nojekyll', '');
  z.file('README.md', `# ${p.name}\n\nA static website. To publish it with GitHub Pages:\n\n1. Create a repository and upload every file in this folder to its root.\n2. Open Settings, then Pages.\n3. Under Build and deployment, choose Deploy from a branch, select main and the / (root) folder, then save.\n4. Open the URL GitHub shows after the first deployment finishes.\n`);
  download(await z.generateAsync({ type: 'blob' }), slug(p.name) + '-github-pages.zip');
}

/* ---------- icons ---------- */
async function iconFrom(sel) {
  const f = $(sel).files[0];
  if (!f) return null;
  if (!f.type.startsWith('image/')) fail('The icon must be an image file.');
  return createImageBitmap(f);
}
async function png(px, src, letter) {
  const c = Object.assign(document.createElement('canvas'), { width: px, height: px }), x = c.getContext('2d');
  if (src) {
    const s = Math.min(src.width, src.height);
    x.drawImage(src, (src.width - s) / 2, (src.height - s) / 2, s, s, 0, 0, px, px);
  } else {
    x.fillStyle = '#f0a53c'; x.fillRect(0, 0, px, px);
    x.fillStyle = '#15130f'; x.font = `800 ${Math.round(px * 0.55)}px Georgia, serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText(letter, px / 2, px * 0.56);
  }
  const blob = await new Promise(r => c.toBlob(r, 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}
function makeIco(pngBytes) {
  // ICO container holding one 256x256 PNG entry (supported by Windows Vista and later)
  const out = new Uint8Array(22 + pngBytes.length), v = new DataView(out.buffer);
  v.setUint16(0, 0, true); v.setUint16(2, 1, true); v.setUint16(4, 1, true);
  out[6] = 0; out[7] = 0; out[8] = 0; out[9] = 0;
  v.setUint16(10, 1, true); v.setUint16(12, 32, true);
  v.setUint32(14, pngBytes.length, true); v.setUint32(18, 22, true);
  out.set(pngBytes, 22);
  return out;
}

/* ---------- Android project generator ---------- */
async function androidZip(o, p) {
  const z = new (zipLib())(), A = 'app/src/main/', pkgDir = o.pkg.split('.').join('/');
  for (const [d, px] of Object.entries({ mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 })) {
    z.file(`${A}res/mipmap-${d}/ic_launcher.png`, await png(px, o.icon, o.letter));
  }
  for (const [path, b] of Object.entries(p.files)) z.file(`${A}assets/site/${path}`, b);
  const files = {
    'settings.gradle': `pluginManagement {\n    repositories { google(); mavenCentral(); gradlePluginPortal() }\n}\ndependencyResolutionManagement {\n    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)\n    repositories { google(); mavenCentral() }\n}\nrootProject.name = "${cs(slug(o.name))}"\ninclude(":app")\n`,
    'build.gradle': "plugins {\n    id 'com.android.application' version '8.5.2' apply false\n}\n",
    'gradle.properties': 'org.gradle.jvmargs=-Xmx2048m\nandroid.useAndroidX=true\n',
    'gradle/wrapper/gradle-wrapper.properties': 'distributionBase=GRADLE_USER_HOME\ndistributionPath=wrapper/dists\ndistributionUrl=https\\://services.gradle.org/distributions/gradle-8.7-bin.zip\nzipStoreBase=GRADLE_USER_HOME\nzipStorePath=wrapper/dists\n',
    'app/build.gradle': `plugins {\n    id 'com.android.application'\n}\n\nandroid {\n    namespace "${o.pkg}"\n    compileSdk 34\n\n    defaultConfig {\n        applicationId "${o.pkg}"\n        minSdk 24\n        targetSdk 34\n        versionCode ${o.code}\n        versionName "${o.ver}"\n    }\n\n    buildTypes {\n        release { minifyEnabled false }\n    }\n\n    compileOptions {\n        sourceCompatibility JavaVersion.VERSION_17\n        targetCompatibility JavaVersion.VERSION_17\n    }\n}\n\ndependencies {\n    implementation 'androidx.appcompat:appcompat:1.7.0'\n}\n`,
    [A + 'AndroidManifest.xml']: `<?xml version="1.0" encoding="utf-8"?>\n<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n    <uses-permission android:name="android.permission.INTERNET" />\n    <application\n        android:allowBackup="true"\n        android:icon="@mipmap/ic_launcher"\n        android:label="@string/app_name"\n        android:supportsRtl="true"\n        android:theme="@style/Theme.App">\n        <activity\n            android:name=".MainActivity"\n            android:configChanges="orientation|screenSize|keyboardHidden"\n            android:exported="true">\n            <intent-filter>\n                <action android:name="android.intent.action.MAIN" />\n                <category android:name="android.intent.category.LAUNCHER" />\n            </intent-filter>\n        </activity>\n    </application>\n</manifest>\n`,
    [A + 'res/values/strings.xml']: `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <string name="app_name">${esc(o.name)}</string>\n</resources>\n`,
    [A + 'res/values/colors.xml']: `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="splash_bg">${o.splash}</color>\n</resources>\n`,
    [A + 'res/values/themes.xml']: `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <style name="Theme.App" parent="Theme.AppCompat.Light.NoActionBar">\n        <item name="android:windowBackground">@color/splash_bg</item>\n    </style>\n</resources>\n`,
    [A + 'res/layout/activity_main.xml']: `<?xml version="1.0" encoding="utf-8"?>\n<FrameLayout xmlns:android="http://schemas.android.com/apk/res/android"\n    android:layout_width="match_parent"\n    android:layout_height="match_parent">\n\n    <WebView\n        android:id="@+id/webview"\n        android:layout_width="match_parent"\n        android:layout_height="match_parent" />\n\n    <LinearLayout\n        android:id="@+id/splash"\n        android:layout_width="match_parent"\n        android:layout_height="match_parent"\n        android:background="@color/splash_bg"\n        android:gravity="center"\n        android:orientation="vertical">\n\n        <ImageView\n            android:layout_width="120dp"\n            android:layout_height="120dp"\n            android:src="@mipmap/ic_launcher" />\n\n        <TextView\n            android:layout_width="wrap_content"\n            android:layout_height="wrap_content"\n            android:layout_marginTop="16dp"\n            android:text="@string/app_name"\n            android:textColor="#FFFFFF"\n            android:textSize="22sp" />\n    </LinearLayout>\n</FrameLayout>\n`,
    [A + `java/${pkgDir}/MainActivity.java`]: `package ${o.pkg};\n\nimport android.content.Intent;\nimport android.net.Uri;\nimport android.os.Bundle;\nimport android.os.Handler;\nimport android.os.Looper;\nimport android.view.View;\nimport android.webkit.WebResourceRequest;\nimport android.webkit.WebView;\nimport android.webkit.WebViewClient;\n\nimport androidx.appcompat.app.AppCompatActivity;\n\npublic class MainActivity extends AppCompatActivity {\n    private static final int SPLASH_MS = ${o.secs * 1000};\n    private static final String START_PAGE = "file:///android_asset/site/${encEntry(p.entry)}";\n    private WebView web;\n    private View splash;\n    private boolean pageReady = false;\n    private boolean splashTimeUp = false;\n\n    @Override\n    protected void onCreate(Bundle savedInstanceState) {\n        super.onCreate(savedInstanceState);\n        setContentView(R.layout.activity_main);\n        web = findViewById(R.id.webview);\n        splash = findViewById(R.id.splash);\n\n        web.getSettings().setJavaScriptEnabled(true);\n        web.getSettings().setDomStorageEnabled(true);\n        web.setWebViewClient(new WebViewClient() {\n            @Override\n            public void onPageFinished(WebView view, String url) {\n                pageReady = true;\n                hideSplashIfDone();\n            }\n\n            @Override\n            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {\n                Uri uri = request.getUrl();\n                if ("file".equals(uri.getScheme())) return false;\n                startActivity(new Intent(Intent.ACTION_VIEW, uri));\n                return true;\n            }\n        });\n\n        new Handler(Looper.getMainLooper()).postDelayed(() -> {\n            splashTimeUp = true;\n            hideSplashIfDone();\n        }, SPLASH_MS);\n        web.loadUrl(START_PAGE);\n    }\n\n    private void hideSplashIfDone() {\n        if (pageReady && splashTimeUp) splash.setVisibility(View.GONE);\n    }\n\n    @Override\n    public void onBackPressed() {\n        if (web.canGoBack()) web.goBack();\n        else super.onBackPressed();\n    }\n}\n`,
    'README-BUILD.md': `# ${o.name}: Android build guide\n\n1. Install Android Studio (Hedgehog or newer) with the Android SDK for platform 34.\n2. Choose File, Open, and select this folder. Wait for Gradle sync. Android Studio creates the Gradle wrapper. If it does not, install Gradle 8.7 and run: gradle wrapper --gradle-version 8.7\n3. Choose Build, Build APK(s). The debug APK is at app/build/outputs/apk/debug/app-debug.apk.\n4. For a release APK, choose Build, Generate Signed App Bundle / APK and follow the wizard. Keep your keystore private and never commit it.\n\nNotes\n- Website files are in app/src/main/assets/site. Edit them there, then rebuild.\n- Launcher icons are generated at 48 to 192 pixels from your image. Use a square image of 512 pixels or more.\n- Splash screen: background ${o.splash}, shown for ${o.secs} seconds or until the page loads.\n- Package ID: ${o.pkg}. Change it before publishing, since it is your app's permanent identity.\n`
  };
  for (const [path, text] of Object.entries(files)) z.file(path, text);
  return z;
}

/* ---------- Windows project generator (C# .NET 8, WinForms + WebView2) ---------- */
async function windowsZip(o, p) {
  const z = new (zipLib())(), N = o.ns;
  z.file(`${N}.csproj`, `<Project Sdk="Microsoft.NET.Sdk">\n  <PropertyGroup>\n    <OutputType>WinExe</OutputType>\n    <TargetFramework>net8.0-windows</TargetFramework>\n    <UseWindowsForms>true</UseWindowsForms>\n    <ImplicitUsings>enable</ImplicitUsings>\n    <Nullable>disable</Nullable>\n    <AssemblyName>${N}</AssemblyName>\n    <RootNamespace>${N}</RootNamespace>\n    <Product>${esc(o.name)}</Product>\n    <Version>${o.ver}</Version>\n    <ApplicationIcon>app.ico</ApplicationIcon>\n  </PropertyGroup>\n  <ItemGroup>\n    <PackageReference Include="Microsoft.Web.WebView2" Version="1.0.2420.47" />\n  </ItemGroup>\n  <ItemGroup>\n    <Content Include="wwwroot\\**\\*" CopyToOutputDirectory="PreserveNewest" />\n  </ItemGroup>\n</Project>\n`);
  z.file('Program.cs', `using System;\nusing System.Windows.Forms;\n\nnamespace ${N}\n{\n    internal static class Program\n    {\n        [STAThread]\n        private static void Main()\n        {\n            Application.EnableVisualStyles();\n            Application.SetCompatibleTextRenderingDefault(false);\n            Application.Run(new MainForm());\n        }\n    }\n}\n`);
  z.file('MainForm.cs', `using System;\nusing System.Diagnostics;\nusing System.IO;\nusing System.Threading.Tasks;\nusing System.Windows.Forms;\nusing Microsoft.Web.WebView2.Core;\nusing Microsoft.Web.WebView2.WinForms;\n\nnamespace ${N}\n{\n    public class MainForm : Form\n    {\n        private readonly WebView2 web = new WebView2 { Dock = DockStyle.Fill };\n\n        public MainForm()\n        {\n            Text = "${cs(o.name)}";\n            ClientSize = new System.Drawing.Size(${o.w}, ${o.h});\n            StartPosition = FormStartPosition.CenterScreen;\n            Controls.Add(web);\n            Load += async (s, e) => await InitAsync();\n        }\n\n        private async Task InitAsync()\n        {\n            await web.EnsureCoreWebView2Async();\n            var core = web.CoreWebView2;\n            string root = Path.Combine(AppContext.BaseDirectory, "wwwroot");\n            core.SetVirtualHostNameToFolderMapping("app.local", root, CoreWebView2HostResourceAccessKind.Allow);\n            core.NewWindowRequested += (s, a) => { a.Handled = true; OpenExternal(a.Uri); };\n            core.NavigationStarting += (s, a) =>\n            {\n                if (a.Uri.StartsWith("http", StringComparison.OrdinalIgnoreCase) && !a.Uri.StartsWith("https://app.local/", StringComparison.OrdinalIgnoreCase))\n                {\n                    a.Cancel = true;\n                    OpenExternal(a.Uri);\n                }\n            };\n            web.Source = new Uri("https://app.local/${encEntry(p.entry)}");\n        }\n\n        private static void OpenExternal(string url)\n        {\n            try { Process.Start(new ProcessStartInfo(url) { UseShellExecute = true }); } catch { }\n        }\n    }\n}\n`);
  z.file('app.ico', makeIco(await png(256, o.icon, o.letter)));
  for (const [path, b] of Object.entries(p.files)) z.file(`wwwroot/${path}`, b);
  z.file('.gitignore', 'bin/\nobj/\n');
  z.file('README-BUILD.md', `# ${o.name}: Windows build guide\n\nRequirements: Windows 10 or 11, the .NET 8 SDK, and the Microsoft Edge WebView2 Runtime (already installed on most Windows 10 and 11 machines).\n\n1. Open a terminal in this folder.\n2. Run: dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true\n3. The executable is in bin\\Release\\net8.0-windows\\win-x64\\publish\\${N}.exe\n4. Keep the wwwroot folder beside the .exe. Copy the whole publish folder to share the app.\n\nNotes\n- Website files are in wwwroot. The app serves them from https://app.local/ and needs no web server.\n- Links to other websites open in the default browser.\n- Build on your machine. HTML Studio generates source files only and does not compile the EXE.\n`);
  return z;
}

/* ---------- builder forms ---------- */
async function buildApk(e) {
  e.preventDefault();
  const name = $('#apk-name').value.trim(), pkg = $('#apk-pkg').value.trim(), ver = $('#apk-ver').value.trim();
  const code = Number($('#apk-code').value), secs = Number($('#apk-secs').value);
  if (!name || name.length > 40) fail('Enter an app name of 40 characters or fewer.');
  if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(pkg) || JKW.test(pkg)) fail('Package ID must look like com.example.app: lowercase letters, digits and underscores, at least two parts, and no Java keywords.');
  if (!/^\d+(\.\d+){0,2}$/.test(ver)) fail('Version name must look like 1.0 or 1.2.3.');
  if (!Number.isInteger(code) || code < 1) fail('Version code must be a whole number of 1 or more.');
  if (!(secs >= 0 && secs <= 10)) fail('Splash time must be between 0 and 10 seconds.');
  const p = await sourceFor('#apk-file');
  const z = await androidZip({ name, pkg, ver, code, secs, splash: $('#apk-splash').value, icon: await iconFrom('#apk-icon'), letter: name[0].toUpperCase() }, p);
  download(await z.generateAsync({ type: 'blob' }), slug(name) + '-android.zip');
  say($('#apk-status'), `Generated an Android Studio project with ${Object.keys(z.files).length} files from ${p.name}. Open README-BUILD.md inside the ZIP for build steps.`);
  toast('Android project ZIP ready.');
}

async function buildExe(e) {
  e.preventDefault();
  const name = $('#exe-name').value.trim(), ver = $('#exe-ver').value.trim();
  const w = Number($('#exe-w').value), h = Number($('#exe-h').value);
  if (!name || name.length > 60) fail('Enter a window title of 60 characters or fewer.');
  if (!/^\d+(\.\d+){0,3}$/.test(ver)) fail('Version must look like 1.0 or 1.0.0.0.');
  if (!Number.isInteger(w) || w < 480 || w > 3840 || !Number.isInteger(h) || h < 360 || h > 2160) fail('Window size must be 480 to 3840 wide and 360 to 2160 high.');
  const p = await sourceFor('#exe-file');
  const z = await windowsZip({ name, ver, w, h, ns: csName(name), letter: name[0].toUpperCase(), icon: await iconFrom('#exe-icon') }, p);
  download(await z.generateAsync({ type: 'blob' }), slug(name) + '-windows.zip');
  say($('#exe-status'), `Generated a .NET 8 WinForms + WebView2 project with ${Object.keys(z.files).length} files from ${p.name}. Open README-BUILD.md inside the ZIP for build steps.`);
  toast('Windows project ZIP ready.');
}

/* ---------- rendering ---------- */
const card = p => `<article class="card">
  <h3>${esc(p.name)}</h3>
  <p class="muted">${Object.keys(p.files).length} files · ${fmt(size(p))} · entry <code>${esc(p.entry)}</code></p>
  <p class="muted small">Updated ${new Date(p.updated).toLocaleString()}</p>
  <div class="actions">
    <button data-act="preview" data-id="${p.id}">Preview</button>
    <button data-act="edit" data-id="${p.id}">Edit</button>
    <button data-act="zip" data-id="${p.id}">Export ZIP</button>
    <button data-act="rename" data-id="${p.id}">Rename</button>
    <button class="danger" data-act="delete" data-id="${p.id}">Delete</button>
  </div></article>`;
const emptyMsg = '<p class="empty">No projects yet. Import an .html file or a website .zip to begin.</p>';

function renderAll() {
  const ps = state.projects, cur = current();
  $('#st-projects').textContent = ps.length;
  $('#st-files').textContent = ps.reduce((a, p) => a + Object.keys(p.files).length, 0);
  $('#st-size').textContent = fmt(ps.reduce((a, p) => a + size(p), 0));
  $('#recent').innerHTML = ps.slice(0, 4).map(card).join('') || emptyMsg;
  $('#project-list').innerHTML = ps.map(card).join('') || emptyMsg;
  const opts = ps.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('') || '<option value="">No projects</option>';
  $$('select[data-project]').forEach(s => { s.innerHTML = opts; s.value = state.id || ''; });
  $('#current').textContent = cur ? cur.name : 'No project selected';
}

const VIEWS = { dashboard: 'Dashboard', import: 'Import', projects: 'Projects', preview: 'Live preview', editor: 'Editor and export', apk: 'HTML to APK', exe: 'HTML to EXE', deploy: 'GitHub Pages', account: 'Account' };
function route() {
  const v = VIEWS[location.hash.slice(1)] ? location.hash.slice(1) : 'dashboard';
  $$('.view').forEach(s => s.classList.toggle('active', s.id === 'view-' + v));
  $$('[data-nav]').forEach(a => a.classList.toggle('on', a.dataset.nav === v));
  $('#title').textContent = VIEWS[v];
  $('.app').classList.remove('nav-open');
  if (v === 'preview') renderPreview().catch(e => toast(e.message, true));
  if (v === 'editor') renderEditor().catch(e => toast(e.message, true));
}

/* ---------- events ---------- */
document.addEventListener('click', guard(async e => {
  const t = e.target;
  const tab = t.closest('[data-tab]');
  if (tab) {
    $$('[data-tab]').forEach(b => b.classList.toggle('on', b === tab));
    $('#pv-frame').hidden = tab.dataset.tab !== 'render';
    $('#pv-source').hidden = tab.dataset.tab === 'render';
    return;
  }
  if (t.closest('#menu')) return $('.app').classList.toggle('nav-open');
  if (t.closest('#pv-refresh')) return renderPreview();
  if (t.closest('#pv-open')) {
    const url = URL.createObjectURL(new Blob([await buildHtml(need())], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener');
    return setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  if (t.closest('#ed-save')) return saveFile();
  if (t.closest('#ed-zip')) return exportZip(need());
  if (t.closest('#ed-html')) return exportHtml(need());
  if (t.closest('#deploy-go')) return pagesBundle(need());
  const b = t.closest('[data-act]');
  if (!b) return;
  const p = state.projects.find(x => x.id === b.dataset.id);
  if (!p) return;
  switch (b.dataset.act) {
    case 'preview': setCurrent(p.id); renderAll(); return go('preview');
    case 'edit': setCurrent(p.id); renderAll(); return go('editor');
    case 'zip': return exportZip(p);
    case 'rename': {
      const n = prompt('Project name', p.name);
      if (!n || !n.trim()) return;
      p.name = n.trim().slice(0, 80); p.updated = Date.now();
      await DB.put(p); return loadProjects();
    }
    case 'delete': {
      if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
      await DB.del(p.id);
      if (state.id === p.id) setCurrent(null);
      toast('Project deleted.');
      return loadProjects();
    }
  }
}));

const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('hot'); }));
['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('hot'); }));

async function importFile(file) {
  const st = $('#import-status');
  if (!file) return;
  try {
    say(st, `Reading ${file.name}…`);
    const p = await ingest(file);
    setCurrent(p.id);
    await loadProjects();
    say(st, `Imported ${p.name}: ${Object.keys(p.files).length} files, entry page ${p.entry}.`);
    toast('Project imported.');
    go('preview');
  } catch (err) { say(st, err.message, true); }
}
drop.addEventListener('drop', e => importFile(e.dataTransfer.files[0]));
$('#file').addEventListener('change', e => { importFile(e.target.files[0]); e.target.value = ''; });

$('#apk-form').addEventListener('submit', guard(buildApk));
$('#exe-form').addEventListener('submit', guard(buildExe));

$('#ed-file').addEventListener('change', guard(async e => {
  if (state.dirty && !confirm('Discard unsaved changes?')) { e.target.value = state.path; return; }
  await loadFile();
}));
$('#ed-text').addEventListener('input', () => { state.dirty = true; say($('#ed-status'), 'Unsaved changes. Press Ctrl+S or Save changes.'); });
$('#ed-text').addEventListener('keydown', guard(e => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); return saveFile(); }
}));

$$('select[data-project]').forEach(s => s.addEventListener('change', guard(e => {
  setCurrent(e.target.value); renderAll(); route();
})));

window.addEventListener('hashchange', route);
loadProjects().catch(e => toast('Could not open the project library: ' + e.message, true)).then(route);
})();
