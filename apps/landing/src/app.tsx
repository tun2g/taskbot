import { Ai } from './sections/ai';
import { Board } from './sections/board';
import { Demo } from './sections/demo';
import { Faq } from './sections/faq';
import { Features } from './sections/features';
import { FinalCta, Footer } from './sections/footer';
import { Hero } from './sections/hero';
import { HowItWorks } from './sections/how-it-works';
import { Mcp } from './sections/mcp';
import { Nav } from './sections/nav';
import { OpenSource } from './sections/open-source';

export function App() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <Board />
        <Ai />
        <Mcp />
        <Demo />
        <OpenSource />
        <Faq />
        <FinalCta />
      </main>
      <Footer />
    </>
  );
}
