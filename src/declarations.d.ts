declare module "*.js" {
  const content: string;
  export default content;
  export const renderMarkdown: (
    md: string,
    sanitize?: (html: string) => string,
  ) => string;
  export const sanitizeOutputHtml: (dirty: string) => string;
}

declare module "*.css" {
  const content: string;
  export default content;
}
