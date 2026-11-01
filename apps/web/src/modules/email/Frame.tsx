/**
 * The body of a message that is a page of HTML. Everything in it was written by whoever sent the email, so none of it may run: it
 * is drawn in a frame that runs no script (the sandbox lets it be the page's neighbour, so that the frame can be fitted to what is
 * in it, and nothing else), and what it holds is handed over exactly as it came — not as markup of this page, where a quote or an
 * entity in it would mean something it was never meant to.
 */
export function Frame({
  html,
  className,
  fit = false,
}: {
  html: string;
  className?: string | undefined;
  /** the frame takes the height of what it shows, and a little more (the admin's page does; the team's keeps one height) */
  fit?: boolean;
}) {
  return (
    <iframe
      className={className}
      sandbox="allow-same-origin"
      srcDoc={html}
      title="Message"
      data-part="bodyFrame"
      onLoad={
        fit
          ? e => {
              const frame = e.currentTarget;
              const doc = frame.contentDocument;
              if (doc?.body) frame.style.height = doc.body.scrollHeight + 40 + 'px';
            }
          : undefined
      }
    />
  );
}
