# Eisenhower Matrix

A small, fast web app for prioritizing tasks with the Eisenhower Matrix. Type a task, answer two questions (how urgent? how important?), and it appears as a dot on a 2x2 grid. Drag dots to re-prioritize. Works offline, installs like an app on desktop and phones, and can be packaged for the Google Play Store.

No frameworks and no build step: the whole app is the `www/` folder.

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
- **Menu (three dots)**: export / import JSON, load sample tasks, clear completed, install the app, about the method.
- **Theme** follows your system setting; the sun / moon button overrides it.
- Press `/` anywhere to jump to the add box.

### Work and Home

Tasks live on one of two matrices, shown as tabs above the add box: **Work** and **Home**. Each has its own dots, lists and Completed section, and the badge on a tab shows how many open tasks it holds.

- Click a tab to switch. The tab you were on is remembered next time.
- Click the active tab again (or press Enter on it) to rename it, for example "Family" or "Side project". Enter saves, Escape cancels.
- New tasks go to the matrix you are looking at. To move a task, open it and change the **Matrix** field.
- Load sample tasks and Clear completed act on the current matrix only. Export saves both matrices; Import puts tasks back on their original matrix and anything unlabelled on the current one. Import never changes your tab names.
- Tasks created before this feature existed appear on Work.

Data is stored in the browser's localStorage on the device you are using. Nothing is sent anywhere. Use Export to back up or move tasks to another device.

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

`node tools/smoke-test.js` drives the app in a headless Edge or Chrome through the DevTools Protocol, runs a set of checks (add flow, drag, keyboard, complete / undo, persistence, matrix tabs and renaming, export, phone layout) and saves screenshots to `tools/screenshots/`. Set `BROWSER=<path to msedge.exe or chrome.exe>` if it cannot find a browser on its own.

## Put it on the web

Any static host works. The app uses relative paths, so it is fine in a sub-folder such as `username.github.io/eisenhower/`.

- **Netlify Drop** (easiest): go to https://app.netlify.com/drop and drag the `www` folder onto the page. You get an https URL immediately.
- **Cloudflare Pages / Vercel**: create a project, point it at this repository, set the output directory to `www`, no build command.
- **GitHub Pages**: Pages serves from the repository root or a `/docs` folder. Either rename `www` to `docs` and choose "main / docs" under Settings > Pages, or add a GitHub Action that publishes the `www` folder.

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
