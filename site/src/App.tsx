import WalletProvider from './providers/WalletProvider';
import Nav from './components/Nav';
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
        <Nav />
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
