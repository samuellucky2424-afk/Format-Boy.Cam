const fs = require('fs');
const path = 'app/src/pages/Wallet.tsx';
let txt = fs.readFileSync(path, 'utf8');

// Replace constants
txt = txt.replace(/const FUND_AMOUNTS = \[[\s\S]*?\];\nconst CREDITS_PER_SECOND = 2;\nconst NGN_PER_CREDIT = 30;/, `const CREDIT_PLANS = [
  { credits: 500, priceNGN: 18500 },
  { credits: 1000, priceNGN: 37000 },
  { credits: 2000, priceNGN: 74000 },
  { credits: 5000, priceNGN: 185000 },
];
const CREDITS_PER_SECOND = 2;`);

// Replace states
txt = txt.replace(/  const \[selectedAmount, setSelectedAmount\] = useState<number \| null>\(null\);\n  const \[customAmount, setCustomAmount\] = useState\(''\);/, `  const [selectedPlan, setSelectedPlan] = useState<typeof CREDIT_PLANS[0] | null>(null);`);

// Replace calculated variables (fundAmount and estimatedCredits)
txt = txt.replace(/  const fundAmount = selectedAmount \|\| Number\(customAmount\) \|\| 0;\n  const estimatedCredits = Math\.floor\(fundAmount \/ NGN_PER_CREDIT\);/, '');

// Fix handleFundWallet logic
txt = txt.replace(/  const handleFundWallet = async \(\) => \{[\s\S]*?    if \(fundAmount < 100\) \{[\s\S]*?      toast\.error\('Minimum purchase amount is NGN 100'\);[\s\S]*?      return;[\s\S]*?    \}/, `  const handleFundWallet = async () => {
    if (!user) {
      toast.error('Please log in to buy credits.');
      return;
    }

    if (!selectedPlan) {
      toast.error('Please select a credit package.');
      return;
    }`);

// Replace meta/amount inside checkout payload
txt = txt.replace(/          amount: fundAmount,/, `          amount: selectedPlan.priceNGN,`);
txt = txt.replace(/            description: \`Buy credits for NGN \$\{fundAmount\.toLocaleString\(\)\}\`,/, `            description: \`Buy \${selectedPlan.credits.toLocaleString()} credits for ₦\${selectedPlan.priceNGN.toLocaleString()}\`,`);
txt = txt.replace(/            logo: "https:\/\/format-boy\.cam\/favicon\.png",/g, `            logo: "/favicon.png",`);

// Replace preset amounts block and custom amount block in the UI
const renderBlockRegex = /\{\/\* Preset amounts \*\/\}[\s\S]*?\{\/\* Pay button \*\/\}/;
const newRenderBlock = `{/* Preset amounts */}
            <label className="block text-xs font-medium text-[#a1a1aa] mb-3">Select Package</label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
              {CREDIT_PLANS.map((plan) => (
                <button
                  key={plan.credits}
                  onClick={() => setSelectedPlan(plan)}
                  className={\`p-4 rounded-xl border text-left transition-all duration-150 \${
                    selectedPlan?.credits === plan.credits
                      ? 'bg-blue-600/15 border-blue-500 ring-2 ring-blue-500/40 shadow-lg shadow-blue-500/10'
                      : 'bg-[#1a1a1f] border-[#27272a] text-white hover:border-[#3f3f46] hover:bg-[#222]'
                  }\`}
                >
                  <div className="flex flex-col">
                    <span className={\`text-lg font-bold \${selectedPlan?.credits === plan.credits ? 'text-blue-400' : 'text-white'}\`}>
                      {plan.credits.toLocaleString()} Credits
                    </span>
                    <span className="text-sm text-[#a1a1aa] mt-1">₦{plan.priceNGN.toLocaleString()}</span>
                  </div>
                </button>
              ))}
            </div>

            {/* Pay button */}`;
txt = txt.replace(renderBlockRegex, newRenderBlock);

// Replace pay button disabled logic and text
txt = txt.replace(/disabled=\{isProcessing \|\| fundAmount < 100\}/, `disabled={isProcessing || !selectedPlan}`);
txt = txt.replace(/Pay NGN \{fundAmount > 0 \? fundAmount\.toLocaleString\(\) : '0'\} with Flutterwave/, `Pay {selectedPlan ? \`₦\${selectedPlan.priceNGN.toLocaleString()}\` : 'with Flutterwave'}`);

fs.writeFileSync(path, txt);
