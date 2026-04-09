const fs = require('fs');
const path = 'app/src/pages/Subscription.tsx';
let txt = fs.readFileSync(path, 'utf8');

// Import PaymentModal
txt = txt.replace(/import \{ apiFetch \} from '@\/lib\/api-client';/, `import { apiFetch } from '@/lib/api-client';\nimport { PaymentModal } from '@/components/PaymentModal';`);

// Add modal state
txt = txt.replace(/  const \[isProcessing, setIsProcessing\] = useState\(false\);/, `  const [isProcessing, setIsProcessing] = useState(false);\n  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);`);

// Replace handleProceedToPayment fully
const oldHandleProceed = /  const handleProceedToPayment = async \(\) => \{[\s\S]*?    if \(\!selectedPlan\) return;[\s\S]*?    if \(\!user\) \{[\s\S]*?      toast\.error\('Please log in to purchase credits\.'\);[\s\S]*?      navigate\('\/login'\);[\s\S]*?      return;[\s\S]*?    \}[\s\S]*?    const amountNGN = selectedPlan\.priceNGN;[\s\S]*?    setIsProcessing\(true\);[\s\S]*?    try \{[\s\S]*?\} catch \(error\) \{[\s\S]*?\}\n  \};/;

const newHandleProceed = `  const handleProceedToPayment = () => {
    if (!selectedPlan) return;
    if (!user) {
      toast.error('Please log in to purchase credits.');
      navigate('/login');
      return;
    }
    setIsPaymentModalOpen(true);
  };`;

txt = txt.replace(oldHandleProceed, newHandleProceed);

// Add PaymentModal before the final closing div
const closingDiv = /    <\/div>\n  \);\n\}/;
txt = txt.replace(closingDiv, `      <PaymentModal 
        isOpen={isPaymentModalOpen} 
        onClose={() => {
          setIsPaymentModalOpen(false);
          setSelectedPlan(null);
        }} 
        plan={selectedPlan} 
      />
    </div>
  );
}`);

fs.writeFileSync(path, txt);
