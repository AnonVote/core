import "./Footer.css";

export default function Footer() {
  return (
    <footer className="footer">
      <div className="footer-left">
        <span className="footer-credit">
          © 2026 AnonVote. Built by{" "}
          <a
            href="https://twitter.com/bamford_jnr"
            target="_blank"
            rel="noopener noreferrer"
            className="link-dark"
          >
            Bamford
          </a>
          .
        </span>
      </div>

      <div className="footer-links">
        <a
          href="https://github.com/Just-Bamford/AnonVote/blob/main/README.md"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          Docs
        </a>
        <a
          href="https://github.com/Just-Bamford/AnonVote/blob/main/CHANGELOG.md"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          Changelog
        </a>
        <a
          href="https://github.com/Just-Bamford/AnonVote"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          GitHub
        </a>
        <a
          href="https://stellar.org"
          target="_blank"
          rel="noopener noreferrer"
          className="footer-link"
        >
          Stellar
        </a>
      </div>
    </footer>
  );
}
