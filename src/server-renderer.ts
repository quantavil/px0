import sanitize from "sanitize-html";
import { renderMarkdown as render } from "./client/preview";
import { isDangerousSrcset, isDangerousUrl } from "./client/shared";

// A real HTML parser handles malformed markup on the Worker, where DOMPurify
// has no DOM. The browser continues to use DOMPurify; neither ships the other's
// sanitizer in its client bundle.
export function sanitizeOutputHtml(dirty: string): string {
  return sanitize(dirty, {
    allowedTags: [...sanitize.defaults.allowedTags, "img", "input", "del"],
    allowedAttributes: {
      "*": ["class", "title"],
      a: ["href", "target", "rel"],
      img: ["src", "srcset", "alt", "width", "height"],
      input: ["type", "checked", "disabled"],
      ol: ["start"],
      td: ["colspan", "rowspan"],
      th: ["colspan", "rowspan", "scope"],
    },
    allowedClasses: { "*": [/^sh__[-\w]+$/, /^language-[-\w]+$/] },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: {
      "*": (tagName, attribs) => {
        for (const attribute of ["href", "src"]) {
          if (attribs[attribute] && isDangerousUrl(attribs[attribute]))
            delete attribs[attribute];
        }
        if (attribs.srcset && isDangerousSrcset(attribs.srcset))
          delete attribs.srcset;
        if (tagName === "a") {
          attribs.target = "_blank";
          attribs.rel = "noopener noreferrer";
        }
        if (tagName === "input") {
          attribs.type = "checkbox";
          attribs.disabled = "";
        }
        return { tagName, attribs };
      },
    },
  });
}

export function renderMarkdown(markdown: string): string {
  return render(markdown, sanitizeOutputHtml);
}
