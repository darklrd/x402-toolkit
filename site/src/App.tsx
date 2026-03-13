import WalletProvider from './providers/WalletProvider';
import WalletButton from './components/WalletButton';
import Hero from './components/Hero';
import PackageCards from './components/PackageCards';
import CodeSnippets from './components/CodeSnippets';
import GettingStarted from './components/GettingStarted';
import Demo from './components/Demo';
import Footer from './components/Footer';

export default function App() {
  return (
    <WalletProvider>
      <div className="min-h-screen">
        <header className="sticky top-0 z-50 flex items-center justify-between border-b border-slate-800 bg-slate-950/80 px-6 py-3 backdrop-blur">
          <span className="font-mono text-sm font-bold text-accent-400">x402</span>
          <WalletButton />
        </header>
        <Hero />
        <PackageCards />
        <CodeSnippets />
        <GettingStarted />
        <Demo />
        <Footer />
      </div>
    </WalletProvider>
  );
}
