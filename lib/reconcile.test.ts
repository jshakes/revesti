import { reconcile } from "./reconcile";

describe("exact block-count matches", () => {
  test("single paragraph, no inline tags", () => {
    const { html, warnings } = reconcile("<p>Hello world.</p>", "Bonjour le monde.");
    expect(html).toBe("<p>Bonjour le monde.</p>");
    expect(warnings).toHaveLength(0);
  });

  test("multiple matched paragraphs, in order", () => {
    const src = "<p>First paragraph.</p><p>Second paragraph.</p>";
    const human = "Premier paragraphe.\nDeuxieme paragraphe.";
    const { html, warnings } = reconcile(src, human);
    expect(html).toBe("<p>Premier paragraphe.</p><p>Deuxieme paragraphe.</p>");
    expect(warnings).toHaveLength(0);
  });

  test("list items matched 1:1", () => {
    const src = "<ul><li>Apple</li><li>Banana</li><li>Cherry</li></ul>";
    const human = "Pomme\nBanane\nCerise";
    const { html } = reconcile(src, human);
    expect(html).toBe("<ul><li>Pomme</li><li>Banane</li><li>Cerise</li></ul>");
  });

  test("flat inline fragment with no block wrapper", () => {
    const src = "Hello <strong>world</strong>, nice to meet you.";
    const human = "Bonjour le monde, ravi de vous rencontrer.";
    const { html } = reconcile(src, human);
    expect(html).not.toContain("__reconcile_root__");
    expect(html).not.toMatch(/^<div/);
    expect(html).toContain("<strong>");
  });

  test("blank lines in the human text are ignored as separators", () => {
    const src = "<p>One.</p><p>Two.</p>";
    const human = "Un.\n\n\nDeux.";
    const { html } = reconcile(src, human);
    expect(html).toBe("<p>Un.</p><p>Deux.</p>");
  });
});

describe("inline tag / attribute preservation", () => {
  test("href, class, and other attributes survive untouched", () => {
    const src =
      '<p>Welcome to our <a href="/store" class="cta" data-id="42">store</a> today.</p>';
    const human = "Bienvenue dans notre boutique aujourd'hui.";
    const { html } = reconcile(src, human);
    expect(html).toContain('href="/store"');
    expect(html).toContain('class="cta"');
    expect(html).toContain('data-id="42"');
  });

  test("inline tag does not pick up leading/trailing whitespace", () => {
    const src =
      '<p>Welcome to our <a href="/store" class="cta">store</a> today.</p>';
    const human = "Bienvenue dans notre boutique aujourd'hui.";
    const { html } = reconcile(src, human);
    expect(html).toMatch(/<a[^>]*>boutique<\/a> aujourd'hui\./);
  });

  test("a short inline element deep in a mismatched-length match never collapses to empty content", () => {
    // Regression test: a 3-character link inside a 31-character block,
    // matched (by length, not meaning) against unrelated 44-character new
    // text, used to produce an invisible <a href="/faq"></a> with no link
    // text because the word-boundary snap search could land behind the
    // segment's own start. The fix guarantees non-empty content whenever
    // the original segment had real length and room was available.
    const src = '<p>Read the <a href="/faq">FAQ</a> for more details.</p>';
    const human = "Merci de votre interet pour notre produit !";
    const { html } = reconcile(src, human);
    expect(html).toMatch(/<a href="\/faq">[^<]+<\/a>/);
    expect(html).not.toContain("<a href=\"/faq\"></a>");
  });

  test("multiple inline tags in one block are each mapped to a distinct span", () => {
    const src =
      '<p>Read our <a href="/terms">terms</a> and our <a href="/privacy">privacy policy</a> before continuing.</p>';
    const human =
      "Lisez nos conditions generales et notre politique de confidentialite avant de continuer.";
    const { html } = reconcile(src, human);
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
    const linkTexts = Array.from(html.matchAll(/<a[^>]*>([^<]*)<\/a>/g)).map(
      (m) => m[1],
    );
    expect(linkTexts).toHaveLength(2);
    expect(linkTexts[0].trim().length).toBeGreaterThan(0);
    expect(linkTexts[1].trim().length).toBeGreaterThan(0);
  });

  test("nested inline tags are preserved recursively", () => {
    const src = '<p>Please <a href="/go"><strong>click here</strong></a> now.</p>';
    const human = "Veuillez cliquer ici maintenant.";
    const { html } = reconcile(src, human);
    expect(html).toMatch(/<a href="\/go"><strong>[^<]*<\/strong><\/a>/);
  });

  test("void inline elements like <br> survive without consuming text", () => {
    const src = "<p>Line one.<br>Line two.</p>";
    const human = "Premiere ligne. Deuxieme ligne.";
    const { html } = reconcile(src, human);
    expect(html).toContain("<br>");
  });
});

describe("fuzzy alignment: splits", () => {
  test("one source paragraph splits into two translated lines", () => {
    const src =
      "<p>This is a long paragraph that covers two distinct ideas in the original.</p>";
    const human =
      "Ceci est la premiere idee.\nEt ceci est la seconde idee distincte.";
    const { html, warnings } = reconcile(src, human);
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).toContain("premiere idee");
    expect(html).toContain("seconde idee");
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("a split paragraph's inline links are not silently duplicated across pieces", () => {
    // Known limitation: splitting falls back to plain-text reconstruction,
    // so inline formatting from the original block is not preserved in
    // either resulting piece. This test locks in that documented trade-off.
    const src =
      '<p>This intro paragraph links to our <a href="/catalog">full catalog</a> and has quite a bit more text besides that to give it real length.</p>';
    const human =
      "Ceci est la premiere partie du texte d'introduction.\nEt voici la seconde partie qui mentionne le catalogue.";
    const { html } = reconcile(src, human);
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(html).not.toContain("<a ");
  });
});

describe("fuzzy alignment: merges", () => {
  test("two source paragraphs merge into one translated line", () => {
    const src = "<p>Part one.</p><p>Part two.</p>";
    const human = "Une seule phrase combinee.";
    const { html } = reconcile(src, human);
    expect(html).toBe("<p>Une seule phrase combinee.</p>");
  });

  test("merge keeps the first block's tag and attributes as the template", () => {
    const src = '<p class="lead">Part one.</p><p>Part two.</p>';
    const human = "Une seule phrase combinee.";
    const { html } = reconcile(src, human);
    expect(html).toBe('<p class="lead">Une seule phrase combinee.</p>');
  });
});

describe("fuzzy alignment: insertions", () => {
  test("a wholly new line with no source counterpart is inserted as a <p>", () => {
    const src = "<p>Intro paragraph.</p><p>Body paragraph.</p>";
    const human = "Introduction.\nNouveau titre ajoute.\nCorps du texte.";
    const { html } = reconcile(src, human);
    expect(html).toBe(
      "<p>Introduction.</p><p>Nouveau titre ajoute.</p><p>Corps du texte.</p>",
    );
  });

  test("an inserted line at the very start is placed before the first block", () => {
    const src = "<p>Body paragraph.</p>";
    const human = "Une phrase ajoutee au debut.\nCorps du texte.";
    const { html } = reconcile(src, human);
    expect(html.indexOf("ajoutee au debut")).toBeLessThan(
      html.indexOf("Corps du texte"),
    );
  });

  test("an inserted line at the very end is appended after the last block", () => {
    const src = "<p>Intro paragraph.</p>";
    const human = "Introduction.\nUne phrase ajoutee a la fin.";
    const { html } = reconcile(src, human);
    expect(html.indexOf("Introduction")).toBeLessThan(
      html.indexOf("ajoutee a la fin"),
    );
  });
});

describe("fuzzy alignment: deletions and tag heterogeneity", () => {
  test("a removed heading is dropped rather than absorbed into a paragraph", () => {
    const src =
      "<h2>A Short Removed Heading</h2><p>This is a substantially longer introductory paragraph with real content in it.</p><p>This is the body paragraph, also with a good amount of real distinguishing text.</p>";
    const human =
      "Ceci est un paragraphe d'introduction sensiblement plus long avec du contenu reel.\nCeci est le paragraphe principal, avec egalement une bonne quantite de texte distinctif reel.";
    const { html, warnings } = reconcile(src, human);
    expect(html).not.toContain("<h2>");
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(warnings.length).toBeGreaterThan(0);
  });

  test("same-tag merges are still allowed (no heterogeneity penalty within one tag type)", () => {
    const src = "<li>Alpha item with some length.</li><li>Beta item with some length.</li>";
    const human = "Un seul element combine avec pas mal de longueur en francais.";
    const { html } = reconcile(src, human);
    expect(html.match(/<li>/g)).toHaveLength(1);
  });
});

describe("combined mutation stress test", () => {
  test("heading kept, paragraph split, two paragraphs merged, and a new paragraph appended — all in one document", () => {
    const src = [
      "<h2>Welcome to Our Store</h2>",
      '<p>We offer a wide selection of products for your home and garden, available in many styles and price ranges.</p>',
      "<p>Free shipping is available on all orders over fifty dollars within the continental United States.</p>",
      "<p>Contact us if you have any questions about sizing, availability, or delivery timelines for your order.</p>",
    ].join("");

    const human = [
      "Bienvenue dans notre boutique",
      "Nous proposons une large selection de produits pour votre maison et votre jardin, disponibles dans de nombreux styles.",
      "Et aussi dans de nombreuses gammes de prix pour tous les budgets disponibles chez nous.",
      "La livraison est gratuite pour toute commande superieure a cinquante dollars aux Etats-Unis continentaux, et vous pouvez nous contacter pour toute question sur la taille, la disponibilite, ou les delais de livraison de votre commande.",
      "Merci de votre visite et a bientot !",
    ].join("\n");

    const { html, warnings } = reconcile(src, human);

    expect(warnings.length).toBeGreaterThan(0);
    // Heading survives as a heading, not absorbed into a paragraph.
    expect(html).toMatch(/<h2>[^<]*<\/h2>/);
    // All five distinct ideas from the translation appear somewhere in the output.
    expect(html).toContain("Bienvenue dans notre boutique");
    expect(html).toContain("large selection");
    expect(html).toContain("gratuite");
    expect(html).toContain("Merci de votre visite");
    // Output is well-formed enough to round-trip through the parser again.
    expect(() => reconcile(html, "Some replacement text.")).not.toThrow();
  });

  test("large multi-paragraph document with scattered links survives split/merge/insert/delete together", () => {
    const src = [
      "<h1>Product Overview</h1>",
      '<p>Our flagship product combines <a href="/features">powerful features</a> with an intuitive design that anyone can pick up quickly.</p>',
      "<p>Pricing starts at just nineteen dollars per month for the basic tier.</p>",
      "<p>Enterprise customers get dedicated support and custom onboarding sessions.</p>",
      '<p>Read the <a href="/faq">FAQ</a> for more details.</p>',
    ].join("");

    // Mutated: heading reworded (kept), first paragraph split in two,
    // second and third paragraphs merged, fourth paragraph kept, and a
    // brand new closing paragraph added.
    const human = [
      "Apercu du produit",
      "Notre produit phare combine des fonctionnalites puissantes avec une conception intuitive.",
      "Que tout le monde peut prendre en main rapidement sans formation prealable.",
      "Les tarifs commencent a dix-neuf dollars par mois pour le niveau de base, et les clients entreprise beneficient d'un support dedie et de sessions d'integration personnalisees.",
      "Consultez la FAQ pour plus de details.",
      "Merci de votre interet pour notre produit !",
    ].join("\n");

    const { html, warnings } = reconcile(src, human);
    const readable = html.replace(/<[^>]+>/g, "");
    expect(warnings.length).toBeGreaterThan(0);
    expect(html).toMatch(/<h1>[^<]*<\/h1>/);
    expect(html).toContain('href="/faq"');
    // With 6 lines of translation against 5 source blocks, the aligner has
    // some freedom in how it pairs blocks — assert on the readable text
    // (tags stripped) rather than an exact tag boundary, since which block
    // ends up carrying which sentence isn't guaranteed without semantic
    // understanding.
    expect(readable).toContain("Merci de votre interet pour notre produit");
  });
});

describe("large-scale / performance stress test", () => {
  test("aligns 60 mutated paragraphs (splits, merges, inserts, deletes) within a reasonable time budget", () => {
    const srcParts: string[] = [];
    const humanParts: string[] = [];

    for (let i = 0; i < 60; i++) {
      const text = `This is source paragraph number ${i} with some representative filler content to give it realistic length for matching purposes.`;
      srcParts.push(`<p>${text}</p>`);

      // Every 7th paragraph: split into two translated lines.
      if (i % 7 === 0) {
        humanParts.push(`Ceci est la premiere moitie du paragraphe numero ${i}.`);
        humanParts.push(`Et voici la seconde moitie du paragraphe numero ${i}.`);
      } else if (i % 11 === 0) {
        // Every 11th: skip entirely (simulate a deletion) by not emitting a line.
        continue;
      } else {
        humanParts.push(
          `Ceci est le paragraphe traduit numero ${i} avec un contenu de remplissage representatif.`,
        );
      }
    }
    // A few wholly new inserted lines with no source counterpart.
    humanParts.push("Une ligne entierement nouvelle sans equivalent source.");
    humanParts.push("Une autre ligne ajoutee a la toute fin du document.");

    const src = srcParts.join("");
    const human = humanParts.join("\n");

    const start = Date.now();
    const { html, warnings } = reconcile(src, human);
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(3000);
    expect(warnings.length).toBeGreaterThan(0);
    expect(html).toContain("Une ligne entierement nouvelle");
    expect(html).toContain("toute fin du document");
    // Every output paragraph should carry real text, never an empty tag.
    expect(html).not.toMatch(/<p><\/p>/);
  });

  test("falls back to positional alignment for pathologically large mismatched inputs", () => {
    // nA * nB comfortably above the 200,000 DP-size safety threshold.
    const srcParts = Array.from(
      { length: 500 },
      (_, i) => `<p>Source paragraph ${i} with filler text to reach a reasonable length for testing.</p>`,
    );
    const humanParts = Array.from(
      { length: 480 },
      (_, i) => `Paragraphe traduit numero ${i} avec du texte de remplissage.`,
    );

    const start = Date.now();
    const { html, warnings } = reconcile(srcParts.join(""), humanParts.join("\n"));
    const elapsedMs = Date.now() - start;

    expect(elapsedMs).toBeLessThan(5000);
    expect(warnings.some((w) => w.includes("simplified positional alignment"))).toBe(
      true,
    );
    expect(html.match(/<p>/g)?.length).toBeGreaterThan(0);
  });
});

describe("non-Latin script content", () => {
  test("CJK text is split and matched correctly by line", () => {
    const src = "<p>Welcome to our store.</p><p>We ship worldwide.</p>";
    const human = "欢迎光临我们的商店。\n我们提供全球配送服务。";
    const { html, warnings } = reconcile(src, human);
    expect(html).toBe("<p>欢迎光临我们的商店。</p><p>我们提供全球配送服务。</p>");
    expect(warnings).toHaveLength(0);
  });

  test("RTL (Arabic) text round-trips through the matcher", () => {
    const src = "<p>Hello there.</p>";
    const human = "مرحبا بكم في متجرنا";
    const { html } = reconcile(src, human);
    expect(html).toBe("<p>مرحبا بكم في متجرنا</p>");
  });
});

describe("error conditions", () => {
  test("throws when the HTML input has no text content", () => {
    expect(() => reconcile("<p></p>", "Some text")).toThrow(
      /no text content/i,
    );
  });

  test("throws when the plain-text input is empty or whitespace-only", () => {
    expect(() => reconcile("<p>Some text.</p>", "   \n\n  ")).toThrow(
      /no text content/i,
    );
  });

  test("throws a clear error rather than silently producing garbage on unparseable input", () => {
    expect(() => reconcile("", "Some text.")).toThrow();
  });
});

describe("malformed / defensive HTML handling", () => {
  test("script and style tags are left untouched and not treated as translatable blocks", () => {
    const src =
      "<script>alert('hi')</script><p>Real content.</p><style>.a{color:red}</style>";
    const human = "Contenu reel.";
    const { html } = reconcile(src, human);
    expect(html).toContain("<script>alert('hi')</script>");
    expect(html).toContain("<style>.a{color:red}</style>");
    expect(html).toContain("Contenu reel.");
  });

  test("gracefully recovers from an unclosed tag rather than crashing", () => {
    expect(() =>
      reconcile("<p>Unclosed paragraph with <strong>bold text", "Texte en gras."),
    ).not.toThrow();
  });
});
