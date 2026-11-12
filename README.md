# Diction Masters — offline app for Windows and Linux

The computer app that installs **with a level's lessons on the computer** (like
Microsoft Office) and works with **no internet, ever**. A school installs a level
from a flash drive; the app shows the computer's **number**; Diction Masters sends
back that computer's **unlock code**; it's typed in once, and every lesson and
video opens. If the computer is ever online, it quietly downloads new and changed
lessons from the website.

This project is separate from the website. The website only has a small
add-on for it: `apps/desktop_edition` in the Django project (codes, licences,
and the lessons export). See `DESKTOP_EDITION_GUIDE.md` there.

```
 website (Django)                                   this app
 ─────────────────────────────────────              ───────────────────────────────
 export_desktop_content  ─ every lesson page, ──►   installer: content/ inside
                           picture, recording,      (sealed, opens only with a code)
                           video, answer key
 /admin/ Activation codes ─ DM-XXXX-XXXX-XXXX ──►   activation screen (once, online)
 /desktop-app/check, latest ◄── when online ───     new lessons, code still valid?
```

## What works offline

Everything a learner of their level sees on the website, looking the same:
EchoSpell (cards, passages, dialogues, activities), the 44 Academy, Tricks to
Sound Fluent, Learning Modules, Reading Club, Assembly Recitals,
Conversational Dialogue, Quick Words, the Reference Library and the Phonemic
Chart. Recordings and videos play from the computer. Read-along highlighting works.

- **Activities are marked on the computer** with the website's own rules,
  and the result shows on the activity page.
- **Progress stays on the computer**: activities tried and passed, "My week"
  on the home page, and voice recordings (Help → Open my recordings folder).
- The learner's **name** shows on the lessons. A code with several levels lets
  them **choose their level** (and change it from the button at the top right).
- Things that need the website (AI tutor, Clash, Scan & Listen, search,
  payments, sending work to a teacher) show a friendly
  "This needs the internet" page with a button to open it on the website.

## The one file to edit: `app.config.json`

| Setting | What it is |
|---|---|
| `version` | Raise it when you publish a new app. New **lessons** don't need a new app. |
| `siteUrl` | The website it activates against and downloads lessons from. |
| `publicKey` | Filled in for you by `npm run content:fetch`. |
| `syncHours` | How often it checks for new lessons while online. |
| `blockScreenCapture` | Screenshots and screen recording show black (Windows). |

## Publishing the installers (on GitHub, no Windows PC needed)

A level with its videos is bigger than a Windows installer can be (2 GB), so
**each level has its own installers** (pages, pictures and recordings inside)
and its **videos travel beside them** in a `videos` folder. The website packs
both into one zip per level for flash drives.

One-time setup, on the **website** (its `DESKTOP_EDITION_GUIDE.md`): the keys
(`manage.py desktop_keys`), `DESKTOP_BUILD_TOKEN`, and a lessons release.
In **this repository**: Settings → Secrets and variables → Actions → secret
**`DM_BUILD_TOKEN`**, the same value as the website's `DESKTOP_BUILD_TOKEN`.

For each level: **Actions → Build installers → Run workflow**, type the level
(e.g. `Level 1`). In about 20 minutes the Releases page (tag `offline`) has:

| Computer | File |
|---|---|
| Windows 10 and 11 | `DictionMasters-Level-1-Setup.exe` |
| Windows 7, 8, 8.1 (32/64-bit) | `DictionMasters-Level-1-Setup-Windows7-8.exe` |
| Ubuntu, Debian, Mint, Zorin | `DictionMasters-Level-1-linux-amd64.deb` |
| Other Linux | `DictionMasters-Level-1-linux-x86_64.AppImage` |
| (the website reads this) | `DictionMasters-Level-1-manifest.json` |

Then on the website: `/admin/` → *Offline app downloads* → *Add* → the level.
It makes `Diction-Masters-Level-1.zip`: the installers (friendly names), the
level's `videos` folder and a READ ME. Unzip it onto a flash drive; any computer
installs from it. The Windows installer copies the videos in
(`build/installer.nsh`); on Linux the app loads them from beside an AppImage, or
from *Help → Load videos from a folder*.

**Unlocking:** the app shows the computer's number; on the website, `/admin/` →
*Unlocked computers* → *Add* makes its code (`src/main/unlock.js` and the
website's `apps/desktop_edition/unlock.py` do the same sums; change both together).

**Unsigned Windows installers** show "Windows protected your PC" → *More info*
→ *Run anyway*. A code-signing certificate removes it: add secrets
`WIN_CSC_LINK` (the .pfx as base64) and `WIN_CSC_KEY_PASSWORD`.

## Try it on your own computer

You need Node.js 22.

```bash
npm install
# lessons from your own Django (in the Django project):
#   python manage.py export_desktop_content --to /tmp/lessons
npm run content:local -- /tmp/lessons
# or from a website:  DM_BUILD_TOKEN=... npm run content:fetch
DM_SITE_URL=http://127.0.0.1:8000 npm start
```

Make a code on the website (`manage.py make_activation_codes --holder Test`) and type it in.

- `npm test`: marking, licences, sealed files, the lesson server.
- `test/e2e.js`: the whole app against a running website (activate, lessons,
  a recording, an activity, offline pages, new lessons): see the top of the file.
- `npm run dist:linux`, `npm run dist:win`, `npm run dist:win7`: installers locally.

## How it fits together (`src/`)

| File | What it does |
|---|---|
| `main/main.js` | The window, menus, activation, and the app's own `dm://app/` addresses. |
| `main/server.js` | Answers every page and file from the lessons on disk; marks activities; keeps progress. |
| `main/content.js` | Finds and unseals lessons (installed, plus downloaded updates). |
| `main/marking.js` | The website's marking rules (`apps/echospell/marking.py`). Change both together. |
| `main/unlock.js` | The computer's number and unlock codes, checked with no internet. |
| `main/licence.js` | Checks a signed licence (online activation, or a computer that went online). |
| `main/sync.js` | Checks in and downloads only the lessons that changed. |
| `main/progress.js` | What the learner did, in the app's data folder. |
| `ui/edition.css`, `ui/edition.js` | Added to every lesson page: hides online-only buttons, the top-right panel, results, today's date. |
| `ui/activate.html` | The activation screen. |

Where things are kept on a computer: the lessons in the install folder
(`resources/content`); the learner's progress, recordings, licence and
downloaded lessons in `%APPDATA%\Diction Masters` (Windows) or
`~/.config/Diction Masters` (Linux). Uninstalling keeps progress.

## Troubleshooting

| Problem | Fix |
|---|---|
| "That code wasn't found" | Check the letters; codes never use 0, O, 1, I, L, 5, S, 2 or Z. |
| "already in use on 1 computer" | In `/admin/` → Activation codes → the code, tick *Revoked* on the old computer, or raise *Seats*. |
| "Couldn't reach the website" when activating | The computer needs the internet just for activation. School proxies are used automatically. |
| A lesson says "hasn't finished downloading" | Connect to the internet; it fills in by itself, or press *Check for new lessons*. |
| Linux AppImage won't start | `sudo apt install libfuse2`, or use the `.deb`. |
| A page looks wrong only in the app | Help → Troubleshooting: developer tools. |
