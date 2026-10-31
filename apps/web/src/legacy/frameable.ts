/**
 * Screens whose classic page cannot be shown from inside a frame, and why (said to the person, on the card that stands in
 * for it). Everything else in the catalogue that has not moved to the new app is shown as its classic page.
 */
export const NOT_FRAMED: Readonly<Record<string, string>> = {
  chat: 'Chat keeps a live connection to the server that the classic page opens for itself. It moves into the new app together with the notification bell and huddles, and works in the classic portal until then.',
};
