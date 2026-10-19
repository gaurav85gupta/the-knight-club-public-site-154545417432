/**
 * INTERIM testimonials source — feedback supplied by the site owner from the
 * existing live website and the 1% Club page. Text is kept as the learners
 * wrote it (only quote marks/spacing normalised). Nothing here was written by
 * the developer or an AI.
 *
 * This file is used ONLY while testimonials.js has no API endpoint configured.
 * When a backend route exists, set TESTIMONIALS_ENDPOINT in testimonials.js
 * and delete this file. Fields: quote + name required; role, program, topic,
 * featured optional. `topic` is the heading the source card carried.
 *
 * NOT included on purpose (see completion notes):
 *  - Devansh Rai: source text is truncated mid-sentence.
 *  - Isha Gupta: says "free access", which contradicts current course pricing.
 *  - Star ratings: shown on the old site but not verified, so not displayed.
 */
window.TESTIMONIALS_SEED = [
  { id: 's1', name: 'Tanya Sharma', topic: 'Beginner friendly', featured: true,
    quote: "I'm a 12th-pass student with zero background — and I still understood everything." },
  { id: 's2', name: 'Aman Verma', topic: 'Content quality',
    quote: 'No fluff. Every lesson is straight to the point and immediately usable.' },
  { id: 's3', name: 'Sneha Kapoor', topic: 'Mentorship',
    quote: 'Aditya actually replies. The 1:1 guidance changed everything for me.' },
  { id: 's4', name: 'Priya Nair', topic: 'Community & support',
    quote: "The community keeps me accountable. Whenever I'm stuck, someone helps within minutes. I never feel alone on this journey." },
  { id: 's5', name: 'Karan Singh', topic: 'Community & support',
    quote: '200+ ambitious people pushing each other forward every day. Pure energy.' },
  { id: 's6', name: 'Rohan Mehta', topic: 'Results',
    quote: "I went from ₹0 to my first ₹1.2 lakh month in 9 weeks. Aditya's system is plug-and-play — I just followed the steps and the sales came." },
  { id: 'm1', name: 'Rohan M.', role: 'Freelance Marketer, Bangalore', program: '1% Club member',
    quote: 'The 1% Club changed my career trajectory. The mentorship alone was worth 10x the price.' },
  { id: 'm2', name: 'Ananya P.', role: 'Content Creator, Mumbai', program: '1% Club member',
    quote: 'I closed my first ₹40k client within 6 weeks of joining. The community keeps me sharp.' },
  { id: 'm3', name: 'Vivek K.', role: 'Solo Founder, Pune', program: '1% Club member',
    quote: 'Chose Content Creation + Freelancing + AI Automation + Digital Marketing. Best decision of 2026.' },
  { id: 'm4', name: 'Sneha R.', role: 'Ex-corporate → Solo, Delhi', program: '1% Club member',
    quote: "Aditya's 1-on-1 call unlocked exactly what I was stuck on. Feels like a real inner circle." }
];
