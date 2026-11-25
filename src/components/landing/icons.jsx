// Simple, consistent line icons used on the landing page (no emojis, no icon libraries).
const P = {
  sparkle: 'M12 3l1.9 5.6L19.5 10.5l-5.6 1.9L12 18l-1.9-5.6L4.5 10.5l5.6-1.9z M19 3v4 M17 5h4',
  history: 'M3.5 12a8.5 8.5 0 102.6-6.1 M3.5 4v4.5H8 M12 7.5V12l3 2',
  doc: 'M7 3h7l5 5v13H7z M14 3v5h5 M10 13h6 M10 17h6',
  mail: 'M3 6h18v12H3z M3 7l9 7 9-7',
  calendar: 'M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4',
  gavel: 'M13 5l5 5-3 3-5-5z M11 11l-7 7 2 2 7-7 M3 21h9',
  clipboard: 'M9 4h6v3H9z M7 5H5v16h14V5h-2 M9 14l2 2 4-4',
  scale: 'M12 4v16 M7 20h10 M5 8h14 M5 8l-3 7a3 3 0 006 0z M19 8l-3 7a3 3 0 006 0z',
  chat: 'M4 5h16v11H9l-5 4z M8 9h8 M8 12h5',
  folder: 'M3 6h6l2 2h10v11H3z',
  pen: 'M4 20l1-4L16 5l3 3L8 19z M14 7l3 3 M3 22h18',
  pound: 'M16 6.5A4 4 0 009 9v8 M6 17h11 M7 12h8',
  mic: 'M12 3a3 3 0 013 3v5a3 3 0 01-6 0V6a3 3 0 013-3z M5 11a7 7 0 0014 0 M12 18v3',
  shield: 'M12 3l8 3v6c0 4.5-3.2 7.8-8 9-4.8-1.2-8-4.5-8-9V6z M9 12l2 2 4-4',
  bolt: 'M13 3L5 14h6l-1 7 8-11h-6z',
  phone: 'M8 3h8v18H8z M11 18h2',
  layers: 'M12 3l9 5-9 5-9-5z M3 13l9 5 9-5',
  qr: 'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M14 14h3v3h-3z M19 14v3 M14 19h6',
  bell: 'M6 16v-5a6 6 0 0112 0v5l2 2H4z M10 20a2 2 0 004 0',
  check: 'M5 12l5 5 9-10',
  arrow: 'M5 12h14 M13 6l6 6-6 6',
  search: 'M11 4a7 7 0 100 14 7 7 0 000-14z M16 16l5 5',
  send: 'M3 11l18-8-8 18-2-8z',
  clock: 'M12 3a9 9 0 100 18 9 9 0 000-18z M12 7v5l3 2',
  link: 'M10 14a4 4 0 005.7 0l3-3a4 4 0 00-5.7-5.7l-1 1 M14 10a4 4 0 00-5.7 0l-3 3a4 4 0 005.7 5.7l1-1',
  list: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
  play: 'M8 5l11 7-11 7z',
};

export default function Icon({ name, size = 24, stroke = 1.7, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={stroke} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" {...rest}>
      <path d={P[name] || P.sparkle} />
    </svg>
  );
}
