const fs = require('fs');
const path = 'app/src/pages/Wallet.tsx';
let txt = fs.readFileSync(path, 'utf8');

// Import PaymentModal
txt = txt.replace(/import \{ toast \} from 'sonner';/, `import { toast } from 'sonner';\nimport { PaymentModal } from '@/components/PaymentModal';`);

// Define payment modal state
txt = txt.replace(/  const \[selectedPlan, setSelectedPlan\] = useState<typeof CREDIT_PLANS\[0\] \| null>\(null\);/, `  const [selectedPlan, setSelectedPlan] = useState<typeof CREDIT_PLANS[0] | null>(null);\n  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);`);

// Replace handleFundWallet
const oldHandleFundWallet = /  const handleFundWallet = async \(\) => \{[\s\S]*?    if \(\!selectedPlan\) \{[\s\S]*?      return;[\s\S]*?    \}[\s\S]*?    setIsProcessing\(true\);[\s\S]*?    try \{[\s\S]*?\} catch \(error\) \{[\s\S]*?\}\n  \};/;
const newHandleFundWallet = `  const handleFundWallet = () => {
    if (!user) {
      toast.error('Please log in to buy credits.');
      return;
    }
    if (!selectedPlan) {
      toast.error('Please select a credit package.');
      return;
    }
    setIsPaymentModalOpen(true);
  };`;

txt = txt.replace(oldHandleFundWallet, newHandleFundWallet);

// Also Wallet doesn't need isProcessing state inside itself if the modal is doing it. (Or I'll just leave it and not use it since the modal blocks anyway)

// Add the <PaymentModal /> before the last </div>
const exportMatch = /\nexport default Wallet;/;
if (exportMatch) {
  txt = txt.replace(exportMatch, `
      <PaymentModal 
        isOpen={isPaymentModalOpen} 
        onClose={() => setIsPaymentModalOpen(false)} 
        plan={selectedPlan} 
      />
    </div>
  );
}

export default Wallet;`);
  // Note: the component already has a `</div>\n  );\n}` at the end, so we will replace just `  );\n}`
  const lastBracket = /  \);\n\}/;
  txt = txt.replace(lastBracket, `
      <PaymentModal 
        isOpen={isPaymentModalOpen} 
        onClose={() => {
          setIsPaymentModalOpen(false);
          setShowFundModal(false); // Optionally close the parent fund UI on complete
        }} 
        plan={selectedPlan} 
      />
  );
}`);
}

fs.writeFileSync(path, txt);
