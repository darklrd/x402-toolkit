export default function Footer() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 py-8">
      <div className="mx-auto max-w-5xl px-6 text-center text-sm text-slate-500">
        <p>
          MIT License ·{' '}
          <a
            href="https://github.com/darklrd/x402-toolkit"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent-400 hover:text-accent-300"
          >
            GitHub
          </a>{' '}
          · Built with x402-toolkit
        </p>
      </div>
    </footer>
  );
}
