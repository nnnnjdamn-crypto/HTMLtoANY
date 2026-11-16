# HTML Studio

HTML Studio is a static web app for importing HTML websites, previewing and editing them, and generating Android (WebView) and Windows (WebView2) source projects. It runs entirely in the browser and deploys to GitHub Pages.

## Features

- Import a single `.html` file or a complete website `.zip`. Assets such as CSS, JavaScript, images, and fonts are kept together.
- Automatic `index.html` detection, with a clear error when no HTML page exists.
- Project manager: preview, edit, rename, export, and delete projects. Data is stored in IndexedDB in your browser.
- Live preview with refresh, an "open in new tab" button, and an HTML source view. Assets are inlined so relative links work without a server.
- Editor for text files with save and Ctrl+S, plus ZIP export and single-file HTML export.
- HTML to APK: generates an Android Studio project (Gradle, WebView, app name, package ID, icon, splash screen) as a ZIP.
- HTML to EXE: generates a C# .NET 8 WinForms + WebView2 project (app title, window size, icon) as a ZIP.
- GitHub Pages bundle: adds `index.html` when needed, `.nojekyll`, and a `README.md`.

## Project structure

    index.html      App shell and views
    style.css       Dark interface and responsive layout
    script.js       Import, validation, preview, editor, and generators
    manifest.json   Web app manifest
    assets/         Icons
    firebase-config.js  Firebase web config (fill in your values)
    auth.js         Sign up, sign in, Google sign-in, sign out
    README.md       This file
    .nojekyll       Tells GitHub Pages to serve files without Jekyll processing

## Run locally

Browsers block ES modules opened from `file://`, so serve the folder over HTTP, for example `python3 -m http.server 8000`, then open `http://localhost:8000`.

## Firebase setup (accounts)

Accounts use Firebase Authentication. Complete these steps once:

1. Go to the Firebase console, add a project, and open Build, then Authentication, then Get started.
2. Under Sign-in method, enable Email/Password and Google.
3. Open Project settings, then Your apps, and add a Web app. Copy the config values into `firebase-config.js`, replacing the placeholders.
4. Under Authentication, Settings, Authorized domains, add your GitHub Pages host, for example `yourname.github.io`. `localhost` is already listed for local testing.

The web config values are identifiers, not secrets. Access is controlled by Authentication, authorized domains, and Security Rules. Never put service account keys or admin credentials in this project.

## Deploy to GitHub Pages

1. Create a repository, for example `html-studio`.
2. Upload every file in this folder to the root of the `main` branch. Keep `.nojekyll` at the root.
3. Go to Settings, then Pages. Under Build and deployment, choose Deploy from a branch, then `main` and `/ (root)`.
4. Open the URL GitHub shows. It is usually `https://<user>.github.io/<repo>/`.

No tokens or secrets are needed. The app does not contain credentials, and it does not send your files anywhere.

## Building generated projects

HTML Studio writes source projects. It does not compile APK or EXE files, because GitHub Pages only serves static files.

- **Android:** Open the generated folder in Android Studio and build the APK. Full steps are in `README-BUILD.md` inside the ZIP.
- **Windows:** Install the .NET 8 SDK and run `dotnet publish -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true` in the generated folder. Full steps are in `README-BUILD.md` inside the ZIP.

## Limitations

- Preview inlines the project's own CSS, JavaScript, and images. Links from one page to another page inside the same project are not followed in the preview.
- ES module scripts (`type="module"`) that import other files are not resolved in the preview.
- Browser storage depends on the browser's quota. Very large projects may need to be trimmed.
- The Android launcher icon is generated at five densities from one image. Use a square image of at least 512 pixels for best results.

## Roadmap

A separate HTML-to-Web Firebase tool is planned. It will reuse the import and validation layer from this app.
