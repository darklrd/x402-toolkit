import WalletProvider from './providers/WalletProvider';
import WalletButton from './components/WalletButton';
import Hero from './components/Hero';
import PackageCards from './components/PackageCards';
import CodeSnippets from './components/CodeSnippets';
import GettingStarted from './components/GettingStarted';
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
        <div id="demo" className="bg-slate-950 py-16 text-center">
          <p className="text-slate-500">Live demo — connect wallet below (coming in next phase)</p>
        </div>
        <Footer />
      </div>
    </WalletProvider>
  );
}
