const fs = require('fs');
const path = 'app/src/pages/Subscription.tsx';
let txt = fs.readFileSync(path, 'utf8');

// Replace CREDIT_PLANS
txt = txt.replace(/const CREDIT_PLANS = \[[\s\S]*?\];/, `const CREDIT_PLANS = [
  { credits: 500, priceNGN: 18500 },
  { credits: 1000, priceNGN: 37000 },
  { credits: 2000, priceNGN: 74000 },
  { credits: 5000, priceNGN: 185000 },
];`);

// Remove ngnRate state and fetching
txt = txt.replace(/  const \[ngnRate, setNgnRate\] = useState<number>\(1500\);\n  const \[isLoadingRate, setIsLoadingRate\] = useState\(true\);\n  const \[isFallbackRate, setIsFallbackRate\] = useState\(false\);\n  const \[rateUpdatedAt, setRateUpdatedAt\] = useState<string \| null>\(null\);\n\n  useEffect\(\(\) => \{[\s\S]*?  \}, \[\]\);/, '');

// Replace handleProceedToPayment amountNGN logic
txt = txt.replace(/const amountNGN = Math\.round\(selectedPlan\.priceUSD \* ngnRate\);/, 'const amountNGN = selectedPlan.priceNGN;');

// Fix logo URL in FlutterwaveCheckout
txt = txt.replace(/logo: "https:\/\/format-boy\.cam\/favicon\.png",/g, 'logo: "/favicon.png",');
txt = txt.replace(/logo: "https:\/\/format-boy\.cam\/logo\.png",/g, 'logo: "/favicon.png",'); // fallback if they used logo.png

// Replace pricing display in mapped plans
txt = txt.replace(/const priceNGN = hasLiveRate \? getPriceNGN\(plan\.priceUSD\) : null;/, 'const priceNGN = plan.priceNGN;');
txt = txt.replace(/<span className="text-xl font-bold text-white">\$\{plan\.priceUSD\}<\/span>\s*\{priceNGN !== null && \(\s*<span className="text-sm text-\[\#71717a\]">\(\NGN \{priceNGN\.toLocaleString\(\)\}\)<\/span>\s*\)\}/, `<span className="text-xl font-bold text-white">₦{priceNGN.toLocaleString()}</span>`);

// Replace getPriceNGN definition and live hints
txt = txt.replace(/  const getPriceNGN = \(priceUSD: number\) => Math\.round\(priceUSD \* ngnRate\);\n  const hasLiveRate = !isLoadingRate && !isFallbackRate;/, '');

// Remove the exchange rate notices from the UI text
txt = txt.replace(/          \{hasLiveRate && \([\s\S]*?\{!isFallbackRate && rateUpdatedAt && \([\s\S]*?\{\/[/*]?\}?[\s\S]*?This could be a mess so let's use a simpler regex for the footer/, '');

const footerMatch = txt.match(/<p className="text-sm text-\[\#71717a\] mb-4">All purchases are one-time\. No subscriptions or hidden fees\.<\/p>[\s\S]*?<\/div>/);
if (footerMatch) {
    const newFooter = `<p className="text-sm text-[#71717a] mb-4">All purchases are one-time. No subscriptions or hidden fees.</p>
        </div>`;
    txt = txt.replace(footerMatch[0], newFooter);
}

// Fixed bottom bar price display
txt = txt.replace(/<span className="text-xl font-bold text-white tracking-tight">\s*\{selectedPlan\.credits\.toLocaleString\(\)\} Credits <span className="text-blue-500 font-normal mx-1">\/<\/span> \$\{selectedPlan\.priceUSD\}\s*\{hasLiveRate && \(\s*<>\s*\{' '\}\s*<span className="text-\[\#71717a\] font-normal">\s*\(\NGN \{getPriceNGN\(selectedPlan\.priceUSD\)\.toLocaleString\(\)\}\)\s*<\/span>\s*<\/>\s*\)\}\s*<\/span>/, `<span className="text-xl font-bold text-white tracking-tight">
                {selectedPlan.credits.toLocaleString()} Credits <span className="text-blue-500 font-normal mx-1">/</span> ₦{selectedPlan.priceNGN.toLocaleString()}
              </span>`);

// Handle any stray USD mentions in descriptions
txt = txt.replace(/description: \`Buy \$\{selectedPlan\.credits\.toLocaleString\(\)\} credits for NGN \$\{amountNGN\.toLocaleString\(\)\}\`,/, `description: \`Buy \$\{selectedPlan.credits.toLocaleString()\} credits for ₦\$\{amountNGN.toLocaleString()\}\`,`);

fs.writeFileSync(path, txt);
