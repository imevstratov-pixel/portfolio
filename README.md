# portfolio-v2

Daniil Evstratov's portfolio, rebuilt on Astro: a black-and-white static site
(v1). Deployed to GitHub Pages by `.github/workflows/deploy.yml`. The same code
goes to two repositories; the workflow reads the target from the repository:

| Repository | URL | Mode |
| --- | --- | --- |
| `imevstratov-pixel/portfolio-v2` | https://imevstratov-pixel.github.io/portfolio-v2/ | sandbox: `PREVIEW=1`, noindex, no analytics, robots.txt disallows |
| `imevstratov-pixel/portfolio` | https://danilevstratov.ru/ (custom domain of its Pages; github.io/portfolio/ redirects there) | live: `PREVIEW=0`, Yandex Metrika, indexable, sitemap.xml |

In both repositories Settings → Pages → Source must be «GitHub Actions»
(the deploy step cannot publish otherwise). For `portfolio` this has to be set
before the first push of this code: see the move checklist below.

```sh
npm ci
npm run dev        # http://localhost:4321/portfolio-v2/
npm run verify     # build + link check + internal-notes and deploy-mode check
SITE=https://danilevstratov.ru BASE=/ PREVIEW=0 npm run verify   # the same for the live site
npm run shots -- --out shots/now   # screenshots at 375, 768, 1280
node tools/build-guide-pdf.mjs [course|ai] <guide draft .md>   # by hand: a free guide PDF and its cover in public/free/
node tools/og.mjs a --to public/assets/og-portrait.png   # by hand, after a preview build: the social preview image
```

Content in `src/content` is a sanitized export and is not edited by hand.
Components, content fields, CSS classes and tools: [docs/components.md](docs/components.md).

## The domain danilevstratov.ru

The live site moves to the root of `danilevstratov.ru` (decision 22 of 15.10).
The workflow reads the address from the repository's Pages settings
(actions/configure-pages): while no custom domain is saved in
`imevstratov-pixel/portfolio` → Settings → Pages, it builds for
`imevstratov-pixel.github.io/portfolio/` as before; once the domain is saved,
the next run builds `SITE=https://danilevstratov.ru BASE=/`, and GitHub
redirects `imevstratov-pixel.github.io/portfolio/<path>` to the same path on
the domain. Set the domain only on `portfolio`, never on a
`imevstratov-pixel.github.io` repository (every project site would move with
it). The staging site stays on github.io/portfolio-v2/.

The switch, in this order (saving the domain before DNS works sends every old
link to an address that does not open):
1. Account Settings → Pages → Add a domain → `danilevstratov.ru`; put its TXT
   record `_github-pages-challenge-imevstratov-pixel` at the registrar; Verify.
2. DNS at the registrar (REG.RU, the domain identified via Gosuslugi, else a
   .ru domain is not delegated): delete the parking A records; A for `@` to
   185.199.108.153, 185.199.109.153, 185.199.110.153, 185.199.111.153; AAAA
   for `@` to 2606:50c0:8000::153 … 2606:50c0:8003::153; CNAME `www` to
   `imevstratov-pixel.github.io.`
3. Wait until public resolvers (8.8.8.8 and Yandex 77.88.8.8) return exactly
   those four A addresses for `danilevstratov.ru` and `www` resolves too.
4. `portfolio` → Settings → Pages → Custom domain → `danilevstratov.ru` (the
   apex, not www) → Save, then at once Actions → «Deploy to GitHub Pages» →
   Run workflow (no code release needed). Until that run ends the domain
   serves the old build, whose assets sit under /portfolio/.
5. Check: `curl -sI https://imevstratov-pixel.github.io/portfolio/hire/`
   answers 301 to the same path on the domain; the domain pages load; the
   workflow log says `Building https://danilevstratov.ru/`.
6. When GitHub has issued the certificate (up to 24 h), tick «Enforce HTTPS».
7. Yandex Metrika: if the counter accepts data only from listed addresses,
   add the domain; URL goals that name `/portfolio/` must name the new paths.
8. Search: Google Search Console, a Domain property verified by a DNS TXT
   record; Yandex Webmaster, `https://danilevstratov.ru` verified by DNS or by
   `yandex_<token>.html` dropped into `public/`; submit
   `https://danilevstratov.ru/sitemap.xml` in both. With the site at the host
   root, robots.txt and sitemap.xml are read by crawlers as they are.
9. Profile links (hh.ru, LinkedIn, Telegram): `https://danilevstratov.ru/hire/`,
   `/en/` for the English CV. The guide and résumé PDFs already link to the
   domain (`SITE_URL` in tools/guide-pdf/engine.mjs, public/resume/*.html,
   rebuilt by hand); send them only once the domain works.

## Режим комментариев (только песочница)

На песочнице https://imevstratov-pixel.github.io/portfolio-v2/ (и в `npm run dev`)
в правом нижнем углу каждой страницы есть кнопка «Комментировать». На основном
сайте её нет: сборка с `PREVIEW=0` её не содержит, а проверка перед публикацией
(`prodcheck`) падает, если она туда попадёт.

Один раз перед первой правкой:
- войдите в GitHub в том браузере, где смотрите сайт (аккаунт imevstratov-pixel);
- в репозитории `imevstratov-pixel/portfolio-v2` создайте метку «правка»
  (Issues, Labels, New label) или попросите об этом Claude. Без неё задачи
  открываются без метки.

Как оставить правку:
1. Нажмите «Комментировать» (или Alt+Shift+C). Пока режим включён, ссылки и
   кнопки сайта не срабатывают: клик только выбирает элемент.
2. Наведите курсор: элемент обводится рамкой. Кликните его, на телефоне
   коснитесь. Выбралось слово внутри кнопки, а нужен весь блок: «Шире»; назад:
   «Уже».
3. Напишите, что поправить.
4. «Отправить»: в новой вкладке откроется готовая задача на GitHub. В ней адрес
   страницы, размер экрана, элемент, его текст, ближайший заголовок и файлы
   кода, где он сделан. Нажмите там кнопку создания задачи (Create).
5. Или «В список»: правки копятся, и потом «Список», «Отправить всё» создаёт
   одну задачу со всеми. Список хранится в этом браузере и не пропадает при
   переходе на другую страницу (выйдите из режима, перейдите по ссылке,
   включите снова). Когда задача создана, нажмите «Очистить».
6. Esc закрывает форму (текст вернётся, если снова выбрать тот же элемент),
   второй Esc выключает режим.

С клавиатуры: Alt+Shift+C, Tab до ссылки или кнопки, стрелки вверх и вниз
расширяют и сужают выбор, влево и вправо переходят к соседнему блоку, Enter
выбирает.

Дальше напишите Claude: «Посмотри правки». Он читает открытые задачи с меткой
«правка», вносит изменения в песочницу и закрывает задачи со ссылкой на
коммит.

Если вкладка не открылась (браузер блокирует новые окна), в окне режима
появится ссылка «Открыть задачу на GitHub». Очень длинный список не помещается
в адрес задачи: тогда текст копируется в буфер обмена, а задача открывается с
просьбой вставить его.

For developers: `tools/comment-mode.mjs` (Astro integration, preview builds and
dev only), `src/scripts/comment-mode.ts` (the button, on every page) and
`src/scripts/comment-mode-ui.ts` (the mode, loaded at the first press); see
docs/components.md, «Staging comment mode». Under Playwright
(`navigator.webdriver`, e.g. `npm run shots`) the button is left out of the
screenshots unless the address has `?comment`.

## Moving the live site to this code (decision 20)

Done in October 2026, kept for the record. The addresses below are the
github.io ones of that time; steps 7 and 8 are replaced by «The domain
danilevstratov.ru» above.

`imevstratov-pixel/portfolio` still holds the old site and has no workflow,
so its Pages source is «Deploy from a branch». A push of this code to its
`main` before the switch would publish the repository root at /portfolio/:
README.md as the home page and `src/` in the open. The old site is archived
in `imevstratov-pixel/portfolio-archive`. In this order:

1. In `imevstratov-pixel/portfolio`: Settings → Pages → Source → «GitHub
   Actions». Only then push.
2. Check the exact commit on a clean clone (untracked files in a working tree
   can hide a missing one):
   ```sh
   git clone https://github.com/imevstratov-pixel/portfolio-v2 /tmp/live-check
   cd /tmp/live-check && npm ci && BASE=/portfolio/ PREVIEW=0 npm run verify
   ```
3. Push `main` to `imevstratov-pixel/portfolio` (its own history is the old
   site, so the push replaces it; the archive keeps the old one).
4. The first run of «Deploy to GitHub Pages» there must log
   `Building https://imevstratov-pixel.github.io/portfolio/ with PREVIEW=0`,
   pass build, check-links and leakcheck, and deploy.
5. Open the live site: `/portfolio/`, `/portfolio/#hire` (→ /hire/),
   `/portfolio/#c1` (→ the case page), `/portfolio/work.html`,
   `/portfolio/en/`, `/portfolio/robots.txt`, `/portfolio/sitemap.xml`; the
   visit shows in Yandex Metrika 111316684.
6. Metrika goals: the site sends `telegram`, `email`, `hire`, `product`,
   `download` and `demo` (docs/components.md, section 7). Add each in the
   counter as a JavaScript-event goal with that identifier, or Metrika
   ignores them.
7. Search engines. robots.txt at /portfolio/robots.txt is not read by
   crawlers (they read only the host root), so they learn about the sitemap
   `https://imevstratov-pixel.github.io/portfolio/sitemap.xml` when it is
   submitted:
   - Google Search Console: a URL-prefix property
     `https://imevstratov-pixel.github.io/portfolio/`, verified with an HTML
     file. Put the downloaded `google<token>.html` into `public/` as is,
     commit, push, press «Verify», then submit the sitemap. No code change:
     production keeps the file byte-identical, preview builds leave it alone
     (tools/legacy-preview.mjs, tools/prodcheck.mjs).
   - Yandex Webmaster adds sites by host: `https://imevstratov-pixel.github.io`.
     Its `yandex_<token>.html` goes to the root of the host, which is the
     repository `imevstratov-pixel/imevstratov-pixel.github.io` (create it if
     there is none, Pages from the `main` branch). A `robots.txt` there with
     `Sitemap: https://imevstratov-pixel.github.io/portfolio/sitemap.xml`
     shows the sitemap to every crawler. Then submit the sitemap in Webmaster.
8. After the move: on hh.ru and LinkedIn the portfolio link becomes
   `https://imevstratov-pixel.github.io/portfolio/hire/`.
