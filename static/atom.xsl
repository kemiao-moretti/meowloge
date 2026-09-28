<?xml version="1.0" encoding="UTF-8"?>
<xsl:stylesheet version="1.0"
  xmlns:xsl="http://www.w3.org/1999/XSL/Transform"
  xmlns:atom="http://www.w3.org/2005/Atom">
  <xsl:output method="html" encoding="UTF-8" indent="yes" />

  <xsl:template match="/">
    <html lang="zh-CN">
      <head>
        <meta charset="UTF-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title><xsl:value-of select="atom:feed/atom:title" /> · Atom 订阅源</title>
        <style>
          :root {
            color-scheme: light dark;
            --paper-bg: #f4f0e6;
            --paper-surface: #fffdf7;
            --paper-surface-alt: #f8f3e7;
            --paper-ink: #303a35;
            --paper-muted: #718078;
            --paper-line: #ded7c7;
            --paper-accent: #6b9a78;
            --paper-accent-strong: #426b4d;
            --paper-accent-soft: #e4eee2;
            --paper-shadow: 0 16px 38px rgba(48, 58, 53, .10);
            --paper-shadow-soft: 0 5px 16px rgba(48, 58, 53, .08);
            --paper-radius: 9px;
            --paper-radius-small: 5px;
          }

          @media (prefers-color-scheme: dark) {
            :root {
              --paper-bg: #1c211f;
              --paper-surface: #242b28;
              --paper-surface-alt: #2b332f;
              --paper-ink: #e9eee7;
              --paper-muted: #a9b5ad;
              --paper-line: #46534a;
              --paper-accent: #8fc29a;
              --paper-accent-strong: #b9e1c0;
              --paper-accent-soft: #314638;
              --paper-shadow: 0 18px 45px rgba(0, 0, 0, .28);
              --paper-shadow-soft: 0 6px 18px rgba(0, 0, 0, .22);
            }
          }

          * { box-sizing: border-box; }

          body {
            min-width: 320px;
            margin: 0;
            color: var(--paper-ink);
            background:
              radial-gradient(circle at 12% 0%, color-mix(in srgb, var(--paper-accent) 12%, transparent), transparent 28rem),
              repeating-linear-gradient(0deg, transparent 0 31px, color-mix(in srgb, var(--paper-line) 45%, transparent) 32px, transparent 33px),
              var(--paper-bg);
            font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
            line-height: 1.7;
          }

          a { color: inherit; }

          .page {
            width: min(1080px, calc(100% - 32px));
            margin: 34px auto 56px;
          }

          .paper {
            overflow: hidden;
            border: 1px solid var(--paper-line);
            border-radius: var(--paper-radius);
            background: color-mix(in srgb, var(--paper-surface) 94%, transparent);
            box-shadow: var(--paper-shadow);
          }

          .hero {
            display: grid;
            grid-template-columns: minmax(0, 1fr) minmax(250px, .42fr);
            gap: 24px;
            padding: clamp(24px, 5vw, 52px);
            border-bottom: 1px dashed var(--paper-line);
            background: linear-gradient(135deg, var(--paper-accent-soft), transparent 58%);
          }

          .eyebrow {
            display: inline-flex;
            width: fit-content;
            align-items: center;
            padding: 5px 10px;
            border: 1px solid var(--paper-line);
            border-radius: 999px;
            color: var(--paper-accent-strong);
            background: var(--paper-surface);
            font-size: 12px;
            font-weight: 800;
            letter-spacing: .04em;
          }

          h1 {
            margin: 15px 0 8px;
            max-width: 760px;
            font-size: clamp(30px, 6vw, 58px);
            line-height: 1.08;
            letter-spacing: -.035em;
          }

          .subtitle {
            max-width: 720px;
            margin: 0;
            color: var(--paper-muted);
            font-size: 15px;
          }

          .meta {
            display: flex;
            flex-wrap: wrap;
            gap: 8px 14px;
            margin-top: 20px;
            color: var(--paper-muted);
            font-size: 13px;
          }

          .meta strong { color: var(--paper-ink); }

          .feed-card {
            align-self: end;
            border: 1px solid var(--paper-line);
            border-radius: var(--paper-radius-small);
            padding: 16px;
            background: var(--paper-surface);
            box-shadow: var(--paper-shadow-soft);
          }

          .feed-card-label {
            margin-bottom: 9px;
            color: var(--paper-accent-strong);
            font-size: 12px;
            font-weight: 800;
          }

          .feed-url {
            display: block;
            width: 100%;
            overflow: hidden;
            border: 1px solid var(--paper-line);
            border-radius: var(--paper-radius-small);
            padding: 9px 10px;
            color: var(--paper-muted);
            background: var(--paper-surface-alt);
            font-family: ui-monospace, SFMono-Regular, Consolas, monospace;
            font-size: 11px;
            line-height: 1.45;
            overflow-wrap: anywhere;
          }

          .copy-button {
            width: 100%;
            margin-top: 10px;
            padding: 9px 12px;
            border: 1px solid var(--paper-accent);
            border-radius: var(--paper-radius-small);
            color: var(--paper-accent-strong);
            background: var(--paper-accent-soft);
            cursor: pointer;
            font: inherit;
            font-size: 13px;
            font-weight: 700;
          }

          .copy-button:hover,
          .copy-button:focus-visible {
            color: var(--paper-surface);
            background: var(--paper-accent-strong);
            outline: 2px solid var(--paper-accent);
            outline-offset: 2px;
          }

          .feed-list {
            padding: clamp(18px, 4vw, 38px);
          }

          .section-heading {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 12px;
            margin: 0 0 18px;
            padding-bottom: 10px;
            border-bottom: 1px solid var(--paper-line);
          }

          .section-heading h2 {
            margin: 0;
            font-size: 20px;
          }

          .section-heading span {
            color: var(--paper-muted);
            font-size: 12px;
          }

          .entry {
            position: relative;
            display: grid;
            grid-template-columns: 8px minmax(0, 1fr);
            gap: 16px;
            padding: 18px 0 22px;
            border-bottom: 1px dashed var(--paper-line);
          }

          .entry:last-child { border-bottom: 0; }

          .entry-mark {
            width: 8px;
            min-height: 100%;
            border-radius: 8px;
            background: var(--paper-accent);
            opacity: .75;
          }

          .entry-main {
            display: grid;
            grid-template-columns: minmax(0, 1fr);
            gap: 16px;
          }

          .entry-main.has-cover {
            grid-template-columns: 190px minmax(0, 1fr);
            align-items: start;
          }

          .entry-cover {
            display: block;
            aspect-ratio: 16 / 10;
            overflow: hidden;
            border: 1px solid var(--paper-line);
            border-radius: var(--paper-radius-small);
            background: var(--paper-surface-alt);
            box-shadow: var(--paper-shadow-soft);
          }

          .entry-cover img {
            display: block;
            width: 100%;
            height: 100%;
            object-fit: cover;
            transition: transform 180ms ease;
          }

          .entry-cover:hover img,
          .entry-cover:focus-visible img {
            transform: scale(1.035);
          }

          .entry h3 {
            margin: 0;
            font-size: clamp(17px, 3vw, 23px);
            line-height: 1.35;
          }

          .entry h3 a {
            text-decoration: none;
            text-decoration-color: var(--paper-accent);
            text-underline-offset: 4px;
          }

          .entry h3 a:hover,
          .entry h3 a:focus-visible {
            color: var(--paper-accent-strong);
            text-decoration: underline;
          }

          .entry-meta {
            display: flex;
            flex-wrap: wrap;
            gap: 6px 13px;
            margin-top: 6px;
            color: var(--paper-muted);
            font-size: 12px;
          }

          .entry-summary {
            display: -webkit-box;
            overflow: hidden;
            margin: 11px 0 0;
            color: var(--paper-muted);
            font-size: 14px;
            line-height: 1.8;
            -webkit-box-orient: vertical;
            -webkit-line-clamp: 5;
          }

          .tags {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
            margin-top: 11px;
          }

          .tag {
            padding: 2px 8px;
            border: 1px solid var(--paper-line);
            border-radius: 999px;
            color: var(--paper-accent-strong);
            background: var(--paper-surface-alt);
            font-size: 11px;
          }

          footer {
            padding: 18px 24px 24px;
            border-top: 1px dashed var(--paper-line);
            color: var(--paper-muted);
            font-size: 12px;
            text-align: center;
          }

          footer a { color: var(--paper-accent-strong); }

          @media (max-width: 720px) {
            .page { width: min(100% - 20px, 600px); margin-top: 10px; }
            .hero { display: block; padding: 24px 18px; }
            .feed-card { margin-top: 22px; }
            .feed-list { padding: 18px; }
            .entry { gap: 11px; }
            .entry-main.has-cover { grid-template-columns: 112px minmax(0, 1fr); gap: 12px; }
            .entry-summary { -webkit-line-clamp: 4; }
          }
        </style>
      </head>
      <body>
        <main class="page">
          <section class="paper">
            <header class="hero">
              <div>
                <div class="eyebrow">Atom 订阅源</div>
                <h1><xsl:value-of select="atom:feed/atom:title" /></h1>
                <p class="subtitle"><xsl:value-of select="atom:feed/atom:subtitle" /></p>
                <div class="meta">
                  <span>文章 <strong><xsl:value-of select="count(atom:feed/atom:entry)" /></strong> 篇</span>
                  <span>最近更新 <strong><xsl:value-of select="substring(atom:feed/atom:updated, 1, 10)" /></strong></span>
                </div>
              </div>
              <aside class="feed-card">
                <div class="feed-card-label">订阅地址</div>
                <code class="feed-url"><xsl:value-of select="atom:feed/atom:link[@rel='self']/@href" /></code>
                <button class="copy-button" type="button" data-feed-url="{atom:feed/atom:link[@rel='self']/@href}">复制订阅地址</button>
              </aside>
            </header>

            <section class="feed-list">
              <div class="section-heading">
                <h2>文章列表</h2>
                <span>按更新时间排列</span>
              </div>
              <xsl:for-each select="atom:feed/atom:entry">
                <article class="entry">
                  <div class="entry-mark" aria-hidden="true"></div>
                  <div>
                    <div>
                      <xsl:attribute name="class">entry-main<xsl:if test="atom:link[@rel='enclosure']"> has-cover</xsl:if></xsl:attribute>
                      <xsl:if test="atom:link[@rel='enclosure']">
                        <a class="entry-cover" href="{atom:link[@rel='alternate']/@href}">
                          <img src="{atom:link[@rel='enclosure']/@href}" alt="{atom:title}" loading="lazy" />
                        </a>
                      </xsl:if>
                      <div class="entry-body">
                        <h3><a href="{atom:link[@rel='alternate']/@href}"><xsl:value-of select="atom:title" /></a></h3>
                        <div class="entry-meta">
                          <span>发布 <xsl:value-of select="substring(atom:published, 1, 10)" /></span>
                          <span>更新 <xsl:value-of select="substring(atom:updated, 1, 10)" /></span>
                        </div>
                        <p class="entry-summary"><xsl:value-of select="atom:summary" /></p>
                        <div class="tags">
                          <xsl:for-each select="atom:category">
                            <span class="tag"><xsl:value-of select="@term" /></span>
                          </xsl:for-each>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              </xsl:for-each>
            </section>

            <footer>
              这是本站的 Atom 订阅源，可直接添加到阅读器中。也可以返回
              <a href="{atom:feed/atom:link[@rel='alternate']/@href}"><xsl:value-of select="atom:feed/atom:title" /></a> 浏览完整内容。
            </footer>
          </section>
        </main>
        <script>
          document.querySelector('.copy-button')?.addEventListener('click', async function () {
            const button = this;
            const text = button.getAttribute('data-feed-url') || '';
            try {
              await navigator.clipboard.writeText(text);
              button.textContent = '已复制';
              setTimeout(() => { button.textContent = '复制订阅地址'; }, 1600);
            } catch (_) {
              button.textContent = '请手动复制上方地址';
            }
          });
        </script>
      </body>
    </html>
  </xsl:template>
</xsl:stylesheet>
