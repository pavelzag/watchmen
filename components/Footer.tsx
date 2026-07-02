export default function Footer() {
  const version = process.env.NEXT_PUBLIC_VERSION ?? "0.7.0";
  return (
    <footer className="text-center py-4 text-xs space-y-1" style={{ color: "#003010" }}>
      <p>Constructed with love by Pavel Zagalsky &nbsp;·&nbsp; <span style={{ color: "#005c16" }}>v{version}</span></p>
      <div className="flex items-center justify-center gap-4 flex-wrap">
        <a href="mailto:zagalsky@gmail.com" style={{ color: "#005c16" }}>
          zagalsky@gmail.com
        </a>
        <a
          href="https://pavelzagalsky.com/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#005c16" }}
        >
          pavelzagalsky.com
        </a>
        <a
          href="https://github.com/pavelzag/watchmen"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: "#005c16" }}
        >
          github.com/pavelzag/watchmen
        </a>
      </div>
    </footer>
  );
}
