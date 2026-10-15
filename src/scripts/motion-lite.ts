// The part of Motion the site uses (decision 2 of 15.10): the WAAPI animate
// of motion/mini and the spring generator, about 6 KB gzip together. The
// accordions import it with the page; the lightbox loads it only when it
// opens with motion allowed (never under prefers-reduced-motion), and both
// share the one chunk.
export { animate } from 'motion/mini';
export { spring } from 'motion';
