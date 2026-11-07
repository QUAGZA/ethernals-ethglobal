"use client";

import { useState } from "react";
import { ExtLink } from "./ext-link";

function GeneratedImage({ src, alt }: { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="m-0 border border-line px-4 py-3 leading-[1.5]">
        This image couldn&apos;t be shown here. <ExtLink href={src}>Open it</ExtLink>
      </p>
    );
  }
  // A plain <img>: these links point at whichever storage host the model uses, so next/image can't list them in advance.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} referrerPolicy="no-referrer" onError={() => setFailed(true)} className="max-h-[420px] w-full border border-line object-contain" />;
}

export function GeneratedImages({ sources, caption }: { sources: string[]; caption?: string }) {
  return (
    <figure className="m-0 flex flex-col gap-3">
      {sources.map((src, i) => (
        <GeneratedImage key={src} src={src} alt={`${caption ?? "Generated image"} ${i + 1}`} />
      ))}
      {caption && <figcaption className="text-[11px] opacity-60">{caption}</figcaption>}
    </figure>
  );
}
