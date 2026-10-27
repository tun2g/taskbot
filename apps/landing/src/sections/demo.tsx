import { Container, SectionHeading } from '@/components/ui';

export function Demo() {
  return (
    <section id="demo" className="pt-24">
      <Container>
        <SectionHeading eyebrow="See it in action" title="One minute, start to finish" />
        <div className="mx-auto mt-12 max-w-4xl overflow-hidden rounded-3xl border border-line bg-surface shadow-float">
          <video
            src="/demo.mp4"
            poster="/demo-poster.jpg"
            className="block aspect-video w-full bg-surface-2"
            controls
            muted
            playsInline
            preload="metadata"
            aria-label="TaskBot demo: creating tasks from a group chat and managing them on the Mini App board"
          />
        </div>
      </Container>
    </section>
  );
}
