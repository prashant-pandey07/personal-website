# Prashant Pandey Personal Website — Developer Guide

Welcome to the official developer guide for Prashant Pandey's personal brand, projects portfolio, and technical research lab. This guide serves as the ultimate manual for maintaining, extending, and publishing content on this personal website.

---

## 🏛️ Directory Architecture

The website is designed with a content-first, static-first philosophy. To maintain clean, human-readable URLs without complex server-side routing, every page is structured using a nested directory approach with a core `index.html` file.

```txt
/ (Root)
├── index.html                   # Homepage (Hero, featured items, and site summary)
├── 404.html                     # Custom 404 Error Page (using root-relative asset paths)
├── sitemap.xml                  # Main XML Sitemap for search engine discovery
├── robots.txt                   # Search Engine Crawl directives
├── feed.xml                     # RSS 2.0 Feed for readers and syndication
├── manifest.webmanifest         # PWA Web App Manifest
├── data/
│   ├── content.json             # Central Content Registry (Single source of truth)
│   └── navigation.json          # Site-wide navigation layout
├── assets/
│   ├── css/
│   │   ├── main.css             # Root tokens, layout resets, utilities, animations
│   │   ├── typography.css       # Font hierarchies, prose spacing, and text sizes
│   │   └── components.css       # Navbars, cards, badges, footers, buttons, and stats
│   ├── js/
│   │   ├── main.js              # Active state nav, scroll tracking, back-to-top buttons
│   │   └── search.js            # Client-side full-text search loading from registry
│   ├── icons/                   # Favicons and manifest icons
│   └── og/                      # Open Graph images for social shares
├── projects/                    # Category: Practical software & tools portfolio
│   ├── index.html               # Projects index page
│   └── [project-slug]/
│       └── index.html           # Project detail page
├── research/                    # Category: Long-form technical essays and publications
│   ├── index.html               # Research index page
│   └── [research-slug]/
│       └── index.html           # Research article detail page
├── blog/                        # Category: Build logs, tutorials, and technical notes
│   ├── index.html               # Blog index page
│   └── [blog-slug]/
│       └── index.html           # Blog post detail page
├── ideas/                       # Category: Speculative concepts and thought experiments
│   ├── index.html               # Ideas index page
│   └── [idea-slug]/
│       └── index.html           # Idea detail page
├── updates/                     # Category: Small, date-based public notes
│   └── index.html               # Updates hub
├── tags/                        # Category: Tag clusters and taxonomy filters
│   └── index.html               # Main tags dashboard
└── search/                      # Category: Client-side search interface
    └── index.html               # Full search results view
```

---

## 🗃️ The Central Content Registry (`data/content.json`)

To ensure client-side search indexing finds new pages immediately, all published content MUST be declared in the central content registry:

📁 `data/content.json`

### Registry Entry Schema

When publishing a new project, research article, blog post, or speculative idea, add a new entry to the `"content"` array inside `data/content.json`:

```json
{
  "title": "My New Project Title",
  "url": "/projects/my-new-project-slug/",
  "type": "Project",
  "date": "2026-05-27",
  "tags": ["python", "ai", "computer-vision"],
  "desc": "A compelling 1-2 sentence description explaining the value and results of this project.",
  "status": "published"
}
```

### Supported Content Fields

| Field | Type | Description |
| :--- | :--- | :--- |
| `title` | `string` | The page title. Appears in search results and automated listings. |
| `url` | `string` | Absolute relative path. Must always start and end with a forward slash `/` (e.g. `/blog/my-post/`). |
| `type` | `string` | Must be one of: `Project`, `Research`, `Blog`, `Idea`, or `Page`. |
| `date` | `string` | Date published in `YYYY-MM-DD` format. Used for chronological sorting. |
| `tags` | `array` | A list of lowercase tags matching existing site taxonomy. |
| `desc` | `string` | Brief, punchy summary of the content (ideally 120–160 characters). |
| `status` | `string` | Set to `"published"` to make it visible in search results, or `"draft"` to ignore. |

---

## 🎨 Design System & CSS Utility Tokens

The site utilizes a premium modern design system defined in `assets/css/main.css` and `assets/css/components.css`. Do not add inline styles; use the variables and utility classes instead.

### Key CSS Variables (Design Tokens)

Use these variables to keep custom page elements consistent:

*   **Backgrounds**:
    *   `var(--bg-root)` (`#07070f`) — Main body background.
    *   `var(--bg-surface)` (`#0e0e1a`) — Secondary surfaces (navigation header, footer, sections).
    *   `var(--bg-card)` (`rgba(255,255,255,0.04)`) — Card block element backgrounds.
*   **Colors & Gradients**:
    *   `var(--accent-1)` (`#6366f1` / Indigo) — Main brand tint, interactive states.
    *   `var(--accent-2)` (`#8b5cf6` / Violet) — Secondary brand highlight.
    *   `var(--accent-teal)` (`#14b8a6`) — Automation/Teal highlight.
    *   `var(--accent-amber)` (`#f59e0b`) — Ideas/Amber highlight.
    *   `var(--gradient-text)` — Sleek metallic background-clip gradient for headers.
*   **Spacing**: Ranges from `var(--space-1)` (`0.25rem`) up to `var(--space-24)` (`6rem`) for consistent padding and margins.
*   **Radii**: `var(--radius-md)` (`12px`), `var(--radius-lg)` (`18px`) for modern curved corners.
*   **Shadows**: `var(--shadow-card)` (inset border + outer soft shadow), `var(--shadow-glow)` (neon indigo aura).

### Standard Layout Class Utilities

*   **`.container`**: Limits layout width to a comfortable readable block. Combine with `.container--content` (`max-width: 780px`) for essays.
*   **`.card`**: Standard rounded background block with a subtle border and glassmorphism. Add `.card--link` to make the entire card hoverable with an upward transition and glow shadow.
*   **`.badge`**: Small pill-shaped metadata chips denoting categories.
*   **`.gradient-text`**: Clips a premium metallic gradient over headers.
*   **`.orb`**: Dynamic background glowing gradients (`.orb--indigo`, `.orb--violet`, `.orb--teal`). Must have `aria-hidden="true"`.
*   **`.breadcrumbs`**: Semantic, accessible header trails (e.g. `Home > Blog > Post Title`).
*   **`.animate-fade-up`**: Smooth entry fade and slide-up micro-animation on load.

---

## 🔍 SEO & Page Metadata Standards

Every HTML document must include complete metadata inside the `<head>` tag. Ensure that URLs in Open Graph tags and canonical entries have trailing slashes.

### Copy-Pasteable `<head>` Boilerplate

```html
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  
  <!-- Page Titles (Primary Topic | Author) -->
  <title>Your Page Title | Prashant Pandey</title>
  <meta name="description" content="A compelling summary of the page details under 160 characters.">
  <meta name="author" content="Prashant Pandey">
  <meta name="robots" content="index, follow">
  
  <!-- Canonical URL (Always secure, lowercase, and trailing slash) -->
  <link rel="canonical" href="https://prashant-pandey.com.np/category/your-slug/">
  
  <meta name="theme-color" content="#6366f1">
  
  <!-- Open Graph / Social Media -->
  <meta property="og:type" content="article">
  <meta property="og:title" content="Your Page Title | Prashant Pandey">
  <meta property="og:description" content="A compelling summary of the page details.">
  <meta property="og:url" content="https://prashant-pandey.com.np/category/your-slug/">
  <meta property="og:image" content="https://prashant-pandey.com.np/assets/og/default.png">
  <meta property="og:site_name" content="Prashant Pandey">
  <meta property="og:locale" content="en_US">
  
  <!-- Twitter Card -->
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="Your Page Title | Prashant Pandey">
  <meta name="twitter:description" content="A compelling summary of the page details.">
  <meta name="twitter:image" content="https://prashant-pandey.com.np/assets/og/default.png">
  
  <!-- Stylesheets (Adjust path depth relative to directory level) -->
  <link rel="stylesheet" href="../../assets/css/main.css">
  <link rel="stylesheet" href="../../assets/css/typography.css">
  <link rel="stylesheet" href="../../assets/css/components.css">
  
  <!-- Favicon, Manifest, and RSS Feed Discovery -->
  <link rel="icon" href="/assets/icons/ico.png" type="image/png">
  <link rel="manifest" href="/manifest.webmanifest">
  <link rel="alternate" type="application/rss+xml" title="Prashant Pandey | Digital Lab" href="https://prashant-pandey.com.np/feed.xml">
</head>
```

---

## 🚀 Step-by-Step Publishing Checklist

Follow these steps to publish new content on the website:

### Step 1: Create Files & Folders
1. Create a directory matching your slug inside the category folder (e.g. `/projects/my-neural-net/`).
2. Inside that directory, create an `index.html` file.
3. Code the page structure using the `<head>` boilerplate above and standard layout blocks (`<nav>`, `<main>`, and `<footer class="footer">`).

### Step 2: Update the Content Registry
Add the metadata entry for your new page in `data/content.json` using the content schema detailed above.

### Step 3: Update `sitemap.xml`
Add a new url node to the `<urlset>` inside `sitemap.xml`:
```xml
  <url>
    <loc>https://prashant-pandey.com.np/projects/my-neural-net/</loc>
    <lastmod>2026-05-27</lastmod>
    <changefreq>monthly</changefreq>
    <priority>0.8</priority>
  </url>
```

### Step 4: Add to RSS Feed (`feed.xml`)
Add an `<item>` tag inside the `<channel>` block in `feed.xml`. Make sure the `pubDate` conforms to the RFC-822 standard, checking that the day of the week matches the day of the week for the specified date and year:
```xml
    <item>
      <title>My Neural Net</title>
      <link>https://prashant-pandey.com.np/projects/my-neural-net/</link>
      <guid>https://prashant-pandey.com.np/projects/my-neural-net/</guid>
      <pubDate>Wed, 27 May 2026 00:00:00 GMT</pubDate>
      <description>A complete walkthrough of building a custom lightweight neural net.</description>
    </item>
```
