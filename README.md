# Eisenhower Matrix

A small, fast web app for prioritizing tasks with the Eisenhower Matrix. Type a task, answer two questions (how urgent? how important?), and it appears as a dot on a 2x2 grid. Drag dots to re-prioritize. Works offline, installs like an app on desktop and phones, and can be packaged for the Google Play Store.

No frameworks and no build step: the whole app is the `www/` folder.

**Live version:** https://mumblescrzy.github.io/Eisenhower-Matrix-App/

## Try it now

Double-click `www/index.html`. Everything works from a local file except the offline cache and the "Install app" option, which browsers only allow over http(s).

To get those too, serve the folder locally (either command, run from this folder):

    python -m http.server 8080 --directory www
    npx serve www

then open http://localhost:8080 (or the URL that `serve` prints).

Tip: add `?demo` to the end of the URL (for example `index.html?demo`) to see nine sample tasks without saving them.

## How it works

The Eisenhower Matrix sorts tasks on two axes, urgency and importance, giving four quadrants:

| Quadrant | Urgent? | Important? | What to do |
|---|---|---|---|
| **Do** | yes | yes | Do it yourself, soon |
| **Schedule** | no | yes | Block time for it |
| **Delegate** | yes | no | Hand it off, or batch it |
| **Eliminate** | no | no | Drop it, or park it |

In the app:

- **Add a task** in the box at the top. A dialog asks how urgent and how important it is (0 to 100 sliders) and previews where it will land. An optional due date and notes are under "Due date & notes".
- **The dot** is plotted at exactly that position: further left means more urgent, higher means more important. A score of 50 or more counts as urgent / important.
- **Drag a dot** to re-prioritize. Tap or click it to edit, complete or delete. With a keyboard, Tab to a dot and use the arrow keys (hold Shift for bigger steps).
- **Lists** beside or below the matrix group tasks by quadrant, sorted by combined score. Tick the box to complete a task; completed tasks collapse into a "Completed" section. Most actions show an Undo toast.
- **Overdue** tasks get a pulsing ring on the matrix and a red chip in the list.
- **Menu (three dots)**: save / load a save file, load sample tasks, clear completed, install the app, about the method.
- **Theme** follows your system setting; the sun / moon button overrides it.
- Press `/` anywhere to jump to the add box, `Ctrl+S` to save, `Ctrl+O` to load.

### Work and Home

Tasks live on one of two matrices, shown as tabs above the add box: **Work** and **Home**. Each has its own dots, lists and Completed section, and the badge on a tab shows how many open tasks it holds.

- Click a tab to switch. The tab you were on is remembered next time.
- Click the active tab again (or press Enter on it) to rename it, for example "Family" or "Side project". Enter saves, Escape cancels.
- New tasks go to the matrix you are looking at. To move a task, open it and change the **Matrix** field.
- Load sample tasks and Clear completed act on the current matrix only. The save file holds both matrices and their names.
- Tasks created before this feature existed appear on Work.

### Save file

Your tasks are always kept in the browser's storage on the device you are using, and nothing is sent anywhere. On top of that you can keep a **save file** on disk, which doubles as a backup and as a way to carry tasks between devices.

- **Save (Ctrl+S)**: the first time, a file dialog asks where to put `eisenhower-matrix.json`. After that, Save writes to the same file.
- **Save as...** picks a different file. **Load from file... (Ctrl+O)** opens a save file and replaces what is on screen, with an Undo in the toast; the loaded file becomes the linked file.
- While a file is linked, a bar under the header shows its name, when it was last saved, and an **Auto-save** switch (on by default) that writes every change to the file about a second after you make it.
- When you reopen the app, the browser needs you to confirm access again: click **Allow saving** in the bar. The app then compares the file with this device. If the file was changed since this device last touched it (for example by the same app on another computer), the file is loaded, with Undo. Otherwise any local changes are written out. After an Undo, auto-save pauses so a newer file is never overwritten silently; **Save now** overwrites it on purpose.
- The **x** in the bar unlinks the file. Your tasks stay in the browser.
- Keeping the save file in a synced folder such as OneDrive, Dropbox or Google Drive gives you a simple way to share tasks between computers.

Linking a file needs the File System Access API, which Chrome, Edge and other Chromium browsers have on desktop. In Firefox, Safari and on Android, Save downloads `eisenhower-matrix.json` and Load opens a file picker instead; there is no linked file or auto-save there, so save again whenever you want a fresh copy.

## Project layout

    www/
      index.html            page structure and dialogs
      styles.css            all styling; light and dark color tokens at the top
      app.js                state, rendering, drag, dialog, storage, PWA hooks
      sw.js                 service worker (offline cache)
      manifest.webmanifest  PWA manifest (name, icons, colors)
      icons/                SVG + PNG icons (192, 512, 512 maskable)

Things you will most likely want to tweak:

- Colors: the `--q-*` tokens at the top of `styles.css`.
- Quadrant names and the one-line advice: `QUADRANTS` near the top of `app.js`.
- Sample tasks: `SAMPLE_TASKS` in `app.js`.
- After any change you deploy, bump `VERSION` in `sw.js` so installed copies refresh their cache.

## Development

There is no build step: edit the files in `www/` and refresh the browser.

`node tools/smoke-test.js` drives the app in a headless Edge or Chrome through the DevTools Protocol, runs a set of checks (add flow, drag, keyboard, complete / undo, persistence, matrix tabs and renaming, save and load, phone layout) and saves screenshots to `tools/screenshots/`. Set `BROWSER=<path to msedge.exe or chrome.exe>` if it cannot find a browser on its own.

## Put it on the web

Any static host works. The app uses relative paths, so it is fine in a sub-folder such as `username.github.io/eisenhower/`.

- **Netlify Drop** (easiest): go to https://app.netlify.com/drop and drag the `www` folder onto the page. You get an https URL immediately.
- **Cloudflare Pages / Vercel**: create a project, point it at this repository, set the output directory to `www`, no build command.
- **GitHub Pages** (already set up for this repo): every push to `main` runs `.github/workflows/pages.yml`, which publishes the `www` folder to https://mumblescrzy.github.io/Eisenhower-Matrix-App/. If the very first run fails, open the repo's Settings > Pages and set Source to "GitHub Actions", then re-run the workflow from the Actions tab.

HTTPS is required for the install prompt, offline mode and the Play Store route below. All of those hosts provide it for free.

## Android (Google Play)

Two routes. Both end with uploading an `.aab` file to the Google Play Console, which needs a one-time developer registration (US$25).

### Route A: PWABuilder (no Android tooling on your PC)

Google Play accepts web apps packaged as a "Trusted Web Activity": a thin native shell that opens your hosted PWA full-screen.

1. Host the app over HTTPS (previous section) and confirm it installs from the browser menu.
2. Go to https://www.pwabuilder.com, enter your URL, and fix anything it flags. It should pass: manifest, icons, service worker and offline support are all included.
3. Choose **Package for stores > Android**, set a package ID (for example `com.yourname.eisenhower`) and app name, and download the zip.
4. The zip contains the `.aab` for Play plus an `assetlinks.json`. Upload `assetlinks.json` to your site at `/.well-known/assetlinks.json`. This proves you own the site; without it Android shows a browser bar at the top of the app.
5. In Play Console create the app, upload the `.aab` under Testing or Production, add the store listing text and screenshots, and submit.

Updating later: redeploy the web files and bump `VERSION` in `sw.js`. The Play package only needs rebuilding if you change the package ID, icons or signing key.

### Route B: Capacitor (native wrapper, no hosting needed)

Capacitor bundles the `www` folder inside a native Android app and lets you add native plugins later (notifications, widgets, and so on). Requires Node.js (already installed) and Android Studio.

    npm init -y
    npm install @capacitor/core @capacitor/cli @capacitor/android
    npx cap init "Eisenhower Matrix" com.yourname.eisenhower --web-dir www
    npx cap add android
    npx cap open android

In Android Studio choose **Build > Generate Signed App Bundle**, create a keystore (keep it safe; every future update must be signed with the same one), and upload the resulting `.aab` to Play Console.

After changing anything in `www/`, run `npx cap copy android` and rebuild.

## Ideas for later

- Sync between devices (needs a small backend or a file-sync service).
- Reminders or notifications for due dates (straightforward in the Capacitor route).
- Recurring tasks, tags, or a weekly review showing how many tasks landed in each quadrant.

## License

MIT. See [LICENSE](LICENSE).
