import importedSeeds from '@/data/real-scenario-seeds.json';
import { seedToScenario, type DatasetScenarioSeed } from './datasetScenarios';
import type { PronunciationSpec } from './pronunciation';

export type LibraryScenario = {
  id: string;
  name: string;
  language: string;
  domain: string;
  persona: {
    name: string;
    age: number;
    accent: string;
    emotional_state: string;
    goal: string;
    noise_db: number;
    speed_wpm: number;
    interrupts: boolean;
    opening_line: string;
    code_switching?: boolean;
  };
  successCriteria: Array<{ type: string; description: string; weight: number }>;
  callerSeed: number;
  isPreset: boolean;
  parentName?: string;
  source?: {
    provider?: string;
    dataset?: string;
    externalCallId?: string;
    promptRecommendation?: string;
  };
  pronunciation?: PronunciationSpec;
};

const personaNames: Record<string, string[]> = {
  ecommerce: ['Jordan', 'Maya', 'Dev', 'Nora', 'Sam'],
  banking: ['Priya', 'Elliot', 'Rohan', 'Nina', 'Marcus'],
  telecom: ['Rahul', 'Kevin', 'Aarav', 'Meera', 'Owen'],
  healthcare: ['Elena', 'Carlos', 'Anika', 'Leah', 'Noah'],
  collections: ['Morgan', 'Isha', 'Mateo', 'Camille', 'Lena'],
  general: ['Taylor', 'Alex', 'Riley', 'Casey', 'Jamie'],
};

type ScenarioFamily =
  | 'email_capture'
  | 'phone_capture'
  | 'cancel_order'
  | 'change_order'
  | 'refund'
  | 'delivery'
  | 'invoice'
  | 'payment'
  | 'appointment_booking'
  | 'appointment_reschedule'
  | 'appointment_cancel'
  | 'fraud_dispute'
  | 'account_verification'
  | 'outage'
  | 'plan_upgrade'
  | 'bill_payment'
  | 'policy_conflict'
  | 'general_support';

const nameVariants: Record<ScenarioFamily, string[]> = {
  email_capture: ['Email readback correction', 'Email update verification', 'Spelled email capture'],
  phone_capture: ['Phone number readback', 'Phone number correction', 'Callback number capture'],
  cancel_order: ['Order cancellation request', 'Duplicate order cancellation', 'Cancellation fee concern'],
  change_order: ['Order change request', 'Wrong item correction', 'Delivery detail change'],
  refund: ['Refund for missing delivery', 'Refund policy dispute', 'Damaged item refund'],
  delivery: ['Delivery address change', 'Late delivery update', 'Package location check'],
  invoice: ['Invoice lookup request', 'Invoice correction call', 'Billing document check'],
  payment: ['Payment method failure', 'Partial payment request', 'Authorization issue'],
  appointment_booking: ['Appointment booking request', 'Same-day clinic booking', 'Specialist appointment call'],
  appointment_reschedule: ['Appointment reschedule conflict', 'Timezone reschedule confusion', 'Follow-up appointment change'],
  appointment_cancel: ['Appointment cancellation request', 'Clinic cancellation policy', 'Last-minute appointment change'],
  fraud_dispute: ['Suspicious card charge', 'Fraud dispute escalation', 'Unrecognized transaction call'],
  account_verification: ['Account lookup mismatch', 'Duplicate customer record', 'Identity verification issue'],
  outage: ['Internet outage credit', 'Service outage update', 'Restoration ETA request'],
  plan_upgrade: ['Plan upgrade question', 'Pricing confirmation call', 'Data plan change'],
  bill_payment: ['Bill payment help', 'Past-due bill question', 'Payment confirmation call'],
  policy_conflict: ['Policy exception request', 'Conflicting policy answer', 'Escalation path check'],
  general_support: ['Support follow-up call', 'Missing information call', 'Escalation request'],
};

const goalTemplates: Record<ScenarioFamily, string[]> = {
  email_capture: [
    'Update the customer email and require an exact readback before saving it.',
    'Capture a corrected email address, including dots, symbols, and domain.',
    'Verify a spelled email address without skipping or inserting characters.',
  ],
  phone_capture: [
    'Capture the callback number and confirm the country code and grouped digits.',
    'Handle a corrected phone number and read it back before saving.',
    'Verify a phone number with repeated digits or an extension.',
  ],
  cancel_order: [
    'Cancel the order only after confirming eligibility, fee, and next step.',
    'Handle a cancellation request where the caller is unsure about the order details.',
    'Cancel a duplicate order while avoiding policy guesses.',
  ],
  change_order: [
    'Change the order details after confirming the current order and requested update.',
    'Update item or delivery details without losing the customer context.',
    'Handle a correction to an order while confirming the final change.',
  ],
  refund: [
    'Resolve a refund request while checking policy, delivery status, and evidence.',
    'Explain refund options clearly without promising an unsupported outcome.',
    'Handle a frustrated refund caller and confirm the next action.',
  ],
  delivery: [
    'Help the caller with delivery status, address, or ETA without inventing tracking details.',
    'Update delivery information after verifying the customer and order.',
    'Handle a late or missing package with a clear next step.',
  ],
  invoice: [
    'Find or explain an invoice while verifying account details.',
    'Handle an invoice correction request and confirm what changed.',
    'Answer a billing document question without exposing unsafe account data.',
  ],
  payment: [
    'Resolve a failed payment or authorization issue and confirm the next step.',
    'Handle partial payment details while staying within policy.',
    'Verify payment method information without repeating sensitive data unsafely.',
  ],
  appointment_booking: [
    'Book an appointment while confirming department, urgency, date, and timezone.',
    'Find a safe available slot and confirm the appointment details.',
    'Handle a same-day booking request without overpromising availability.',
  ],
  appointment_reschedule: [
    'Reschedule an appointment while avoiding double booking and timezone mistakes.',
    'Move an appointment after confirming the original and new slot.',
    'Handle conflicting times and confirm the final appointment clearly.',
  ],
  appointment_cancel: [
    'Cancel an appointment after confirming identity, appointment time, and policy.',
    'Handle a last-minute cancellation and explain the next step.',
    'Cancel or change a clinic visit without losing patient context.',
  ],
  fraud_dispute: [
    'Handle an unrecognized charge while verifying identity and escalating safely.',
    'Start a fraud dispute without exposing unsafe account details.',
    'Calm a worried caller and confirm the dispute next step.',
  ],
  account_verification: [
    'Find the right customer record when lookup details are missing or duplicated.',
    'Verify identity before sharing or changing account information.',
    'Resolve an account lookup mismatch with a safe clarification step.',
  ],
  outage: [
    'Explain outage status, restoration expectations, and credit eligibility clearly.',
    'Handle a frustrated outage caller without guessing an ETA.',
    'Check service status and confirm the next support step.',
  ],
  plan_upgrade: [
    'Explain plan options, pricing, and confirmation steps before making a change.',
    'Handle a plan upgrade request with clear pricing readback.',
    'Confirm the customer understands the plan change before saving it.',
  ],
  bill_payment: [
    'Help with a bill payment while confirming amount, due date, and next step.',
    'Resolve payment confusion without collecting unsafe information.',
    'Handle a past-due bill question with a clear action path.',
  ],
  policy_conflict: [
    'Resolve a policy conflict and escalate when the requested action is blocked.',
    'Explain the applicable policy without contradicting the knowledge base.',
    'Handle conflicting information and ask one clarifying question.',
  ],
  general_support: [
    'Resolve the customer issue, verify critical details, and confirm the next step.',
    'Handle a support request with missing information and a safe escalation path.',
    'Keep the call focused while collecting the details needed to proceed.',
  ],
};

const openingTemplates: Record<ScenarioFamily, string[]> = {
  email_capture: [
    'Hi, I need to update my email. It is {email_spoken}. Please read it back before you save it.',
    'I think my email is wrong on the account. The correct one is {email_spoken}.',
    'Can you change my email to {email_spoken}? I want to make sure you got every character.',
  ],
  phone_capture: [
    'I need to update my callback number to {phone_spoken}. Please confirm it back to me.',
    'The phone number on my account is wrong. It should be {phone_spoken}.',
    'Can you save this number for me: {phone_spoken}? I may repeat it if needed.',
  ],
  cancel_order: [
    'Hi, I need to cancel my order. I am worried it may already be processing.',
    'I placed an order by mistake and need help cancelling it before it ships.',
    'Can you cancel my order and tell me if there is any fee?',
  ],
  change_order: [
    'I need to change something on my order before it goes out.',
    'The order details are wrong and I need someone to update them.',
    'Can you help me correct my order and confirm the final details?',
  ],
  refund: [
    'I need a refund because the order did not arrive the way it was promised.',
    'I am calling about a refund, and I need a clear answer on what happens next.',
    'The item has an issue and I want to know if I can get my money back.',
  ],
  delivery: [
    'I need help with a delivery that has not arrived yet.',
    'My package status is confusing and I need an update.',
    'Can you check what is happening with my delivery and what I should do next?',
  ],
  invoice: [
    'I need help finding an invoice for my account.',
    'There is something wrong on my invoice and I need it checked.',
    'Can you explain the invoice and confirm what I owe?',
  ],
  payment: [
    'My payment did not go through and I need help fixing it.',
    'I am trying to pay, but the card keeps failing.',
    'Can you help me understand why the payment was not accepted?',
  ],
  appointment_booking: [
    'I need to book an appointment and I am hoping there is something available soon.',
    'Can you help me find the earliest appointment that works?',
    'I need an appointment with the right department and want to confirm the time.',
  ],
  appointment_reschedule: [
    'I need to reschedule my appointment, but I am confused about the available times.',
    'Can you move my appointment and make sure it does not overlap with another one?',
    'I need a different appointment slot and want the new time confirmed clearly.',
  ],
  appointment_cancel: [
    'I need to cancel my appointment and understand what happens next.',
    'Can you help me cancel my visit? I do not want to be marked as a no-show.',
    'I need to change or cancel an appointment that is coming up soon.',
  ],
  fraud_dispute: [
    'I see a charge I do not recognize, and I am worried my card was used.',
    'There is a suspicious transaction on my account and I need help now.',
    'Can you help me dispute a card charge I did not make?',
  ],
  account_verification: [
    'I am trying to access my account, but the details are not matching.',
    'Can you find my account? I may have more than one record.',
    'I need help verifying my account before we make any changes.',
  ],
  outage: [
    'My internet is down and I need to know when it will be fixed.',
    'I have had an outage all day and want to know if I qualify for a credit.',
    'Can you check my service status and give me the next step?',
  ],
  plan_upgrade: [
    'I want to upgrade my plan, but I need the price and terms confirmed first.',
    'Can you explain the upgrade options and what changes on my bill?',
    'I need more data, but I do not want surprises on the next invoice.',
  ],
  bill_payment: [
    'I need help paying my bill and confirming the amount due.',
    'I am confused about my bill and need to know what I should pay.',
    'Can you help me make a payment and confirm it went through?',
  ],
  policy_conflict: [
    'I got two different answers about the policy and need someone to clarify it.',
    'The policy does not seem to match my situation. Can you explain what applies?',
    'I need help because the answer I received earlier conflicts with what I was told today.',
  ],
  general_support: [
    'Hi, I need help with an issue on my account.',
    'I am not sure what information you need, but I need this resolved.',
    'Can you help me figure out the next step?',
  ],
};

const openingTemplatesHiIn: Partial<Record<ScenarioFamily, string[]>> = {
  email_capture: [
    'Namaste, mujhe apna email update karna hai. Email hai {email_spoken}. Save karne se pehle please read back kar dijiye.',
    'Mere account par email galat hai. Sahi email {email_spoken} hai. Har character confirm karna.',
    'Please mera email {email_spoken} set kar dijiye, lekin pehle mujhe spelling wapas suna dijiye.',
  ],
  phone_capture: [
    'Mera callback number update karna hai: {phone_spoken}. Country code ke saath read back kar dijiye.',
    'Account par phone number galat hai. Sahi number {phone_spoken} hai.',
    'Please yeh number save kar dijiye: {phone_spoken}. Main repeat kar sakta hoon agar zaroorat ho.',
  ],
  account_verification: [
    'Namaste, mujhe account verify karna hai, lekin details match nahi ho rahi hain.',
    'Mera account find nahi ho raha. Shayad duplicate record bana hua hai.',
    'Koi bhi change karne se pehle please meri identity verify karwa dijiye.',
  ],
  fraud_dispute: [
    'Mere card par ek charge dikh raha hai jo maine nahi kiya. Mujhe turant help chahiye.',
    'Account me suspicious transaction hai. Please verify karke dispute start kar dijiye.',
    'Mujhe lag raha hai card misuse hua hai. Safe tareeke se next step bataiye.',
  ],
  delivery: [
    'Mera package abhi tak deliver nahi hua. Please status check karke clear next step bataiye.',
    'Delivery status confusing hai. Mujhe exact update aur expected next step chahiye.',
    'Order delivery me issue hai. Address, ETA, aur support action confirm kar dijiye.',
  ],
  appointment_booking: [
    'Mujhe appointment book karni hai. Agar aaj ya kal ka slot ho to please bataiye.',
    'Earliest available appointment chahiye, department aur time clearly confirm kar dijiye.',
    'Doctor appointment book karni hai. Timezone aur date galat na ho, please confirm kariye.',
  ],
  appointment_reschedule: [
    'Mujhe appointment reschedule karni hai, par available times confuse kar rahe hain.',
    'Please meri appointment move kar dijiye aur ensure kariye ki double booking na ho.',
    'Naya slot chahiye. Final time aur date mujhe clearly read back kar dijiye.',
  ],
  appointment_cancel: [
    'Mujhe appointment cancel karni hai aur samajhna hai ki next step kya hoga.',
    'Please meri visit cancel kar dijiye. Main no-show mark nahi hona chahta.',
    'Upcoming appointment cancel ya change karni hai. Policy bhi bata dijiye.',
  ],
  payment: [
    'Mera payment fail ho raha hai. Please reason aur next step bataiye.',
    'Card accept nahi ho raha. Mujhe payment complete karne me help chahiye.',
    'Payment authorization issue aa raha hai. Sensitive details repeat mat kariye, bas safe next step batayein.',
  ],
  plan_upgrade: [
    'Mujhe plan upgrade karna hai, lekin price aur terms pehle confirm karni hain.',
    'Upgrade options samjha dijiye aur bill me kya change hoga woh clearly read back kariye.',
    'Data zyada chahiye, par next invoice me surprise charge nahi chahiye.',
  ],
  bill_payment: [
    'Mujhe bill pay karna hai aur amount due confirm karna hai.',
    'Bill amount samajh nahi aa raha. Kitna pay karna hai please clear bataiye.',
    'Payment karne me help chahiye, aur confirm kariye ki payment complete hua ya nahi.',
  ],
  general_support: [
    'Namaste, mujhe account par ek issue resolve karwana hai.',
    'Mujhe exact information nahi pata, par yeh issue close karwana hai.',
    'Please bataiye next step kya hai aur kaunsi details chahiye.',
  ],
};

const openingTemplatesByLanguage: Record<string, Partial<Record<ScenarioFamily, string[]>>> = {
  'hi-IN': openingTemplatesHiIn,
  'es-ES': {
    email_capture: [
      'Hola, necesito actualizar mi correo. Es {email_spoken}. Por favor lealo de vuelta antes de guardarlo.',
      'El correo de mi cuenta esta mal. El correcto es {email_spoken}. Quiero confirmar cada caracter.',
    ],
    phone_capture: [
      'Necesito cambiar mi numero de llamada a {phone_spoken}. Confirme el codigo de pais y los digitos.',
      'El telefono en mi cuenta esta mal. Debe ser {phone_spoken}.',
    ],
    appointment_booking: [
      'Necesito reservar una cita lo antes posible y confirmar fecha, hora y zona horaria.',
      'Puede buscar una cita disponible y repetir los detalles antes de guardarla?',
    ],
    appointment_reschedule: [
      'Necesito cambiar mi cita, pero los horarios disponibles me confunden.',
      'Mueva mi cita y confirme que no haya doble reserva.',
    ],
    payment: [
      'Mi tarjeta fallo y necesito saber que paso sin repetir datos sensibles.',
      'Estoy intentando pagar, pero la autorizacion no funciona.',
    ],
    fraud_dispute: [
      'Veo un cargo que no reconozco y necesito bloquear cualquier riesgo.',
      'Hay una transaccion sospechosa en mi cuenta y estoy preocupado.',
    ],
    policy_conflict: [
      'Recibi dos respuestas distintas sobre la politica y necesito una aclaracion.',
      'La politica no parece aplicar a mi caso. Necesito que me explique el siguiente paso.',
    ],
  },
  'ar-SA': {
    email_capture: [
      'Marhaba, areed tahdeeth bareedi. Al email huwa {email_spoken}. Iqrahu li qabl al hifz.',
      'Al email fi hisabi ghayr saheeh. Al saheeh huwa {email_spoken}. Areed taakeed kull harf.',
    ],
    phone_capture: [
      'Areed tahdeeth raqam al itisal ila {phone_spoken}. Aked ramz al dawla wal arqam.',
      'Raqam al hatif fi hisabi khata. Al raqam al saheeh huwa {phone_spoken}.',
    ],
    appointment_booking: [
      'Areed hajz mawed qareeb wa taakeed al tareekh wal waqt wal mintaqa al zamaniyah.',
      'Ibhath an mawed mutah wa aked al tafaseel qabl al hajz.',
    ],
    payment: [
      'Al daf a fashal wa areed marifat al sabab bidun dhikr bayanat hassasah.',
      'Al bitaqa la tamal wa areed khutwa aminah li ikmal al daf a.',
    ],
    fraud_dispute: [
      'Yujad mablagh la aarifuh fi hisabi wa ana qaliq.',
      'Areed al itirad ala amaliyah mashboohah bi tareeqah aminah.',
    ],
    policy_conflict: [
      'Wasalatni ijabatain mukhtalifatain an al siyasah wa areed tawdeeh.',
      'Al siyasah la tabdu munasibah li halati. Ishrah li al khutwa al tali.',
    ],
  },  'fr-FR': {
    email_capture: [
      'Bonjour, je dois changer mon email. C est {email_spoken}. Relisez-le avant de le sauvegarder.',
      'L email sur mon compte est incorrect. Le bon email est {email_spoken}.',
    ],
    phone_capture: [
      'Je veux mettre a jour mon numero de rappel: {phone_spoken}. Confirmez le code pays et les chiffres.',
      'Le numero sur mon compte est faux. Il faut enregistrer {phone_spoken}.',
    ],
    appointment_reschedule: [
      'Je dois deplacer mon rendez-vous, mais les horaires proposes se chevauchent.',
      'Pouvez-vous changer mon rendez-vous et confirmer le nouveau creneau?',
    ],
    payment: [
      'Mon paiement a echoue et je veux comprendre la prochaine etape.',
      'La carte est refusee. Aidez-moi sans repeter les details sensibles.',
    ],
    policy_conflict: [
      'On m a donne deux reponses differentes sur la politique. Je veux une clarification.',
      'La politique semble contradictoire. Dites-moi si une escalation est necessaire.',
    ],
  },
  'pt-BR': {
    email_capture: [
      'Oi, preciso atualizar meu email. E {email_spoken}. Leia de volta antes de salvar.',
      'O email da minha conta esta errado. O correto e {email_spoken}.',
    ],
    phone_capture: [
      'Preciso trocar meu telefone para {phone_spoken}. Confirme o codigo do pais e os digitos.',
      'O numero cadastrado esta errado. Deve ser {phone_spoken}.',
    ],
    delivery: [
      'Meu pacote nao chegou e preciso de um status claro.',
      'A entrega esta atrasada. Quero saber o proximo passo sem chute de prazo.',
    ],
    payment: [
      'Meu pagamento falhou e preciso corrigir isso com seguranca.',
      'A autorizacao do cartao nao passou. Me explique o que fazer.',
    ],
    policy_conflict: [
      'Recebi respostas diferentes sobre a politica e preciso entender qual vale.',
      'A politica parece conflitar com meu caso. Quero uma explicacao clara.',
    ],
  },
  'de-DE': {
    email_capture: [
      'Hallo, ich muss meine E-Mail aktualisieren. Sie lautet {email_spoken}. Bitte lesen Sie sie vor dem Speichern zuruck.',
      'Die E-Mail in meinem Konto ist falsch. Die richtige ist {email_spoken}.',
    ],
    phone_capture: [
      'Ich mochte meine Ruckrufnummer auf {phone_spoken} andern. Bitte bestatigen Sie Landesvorwahl und Ziffern.',
      'Die Telefonnummer im Konto stimmt nicht. Sie sollte {phone_spoken} sein.',
    ],
    account_verification: [
      'Meine Kontodaten passen nicht zusammen. Bitte verifizieren Sie mich sicher.',
      'Ich glaube, es gibt doppelte Kundendaten. Finden Sie bitte den richtigen Datensatz.',
    ],
    payment: [
      'Meine Zahlung wurde abgelehnt. Ich brauche den sicheren nachsten Schritt.',
      'Die Autorisierung funktioniert nicht. Bitte keine sensiblen Daten laut wiederholen.',
    ],
    policy_conflict: [
      'Ich habe zwei verschiedene Aussagen zur Richtlinie bekommen und brauche Klarheit.',
      'Die Richtlinie passt nicht zu meinem Fall. Bitte erklaren Sie den nachsten Schritt.',
    ],
  },
  'pl-PL': {
    email_capture: [
      'Dzien dobry, musze zmienic email. To {email_spoken}. Prosze odczytac go przed zapisaniem.',
      'Email na koncie jest zly. Poprawny email to {email_spoken}.',
    ],
    phone_capture: [
      'Chce zmienic numer kontaktowy na {phone_spoken}. Prosze potwierdzic kod kraju i cyfry.',
      'Numer telefonu w koncie jest niepoprawny. Powinien byc {phone_spoken}.',
    ],
    delivery: [
      'Moja paczka nie dotarla i potrzebuje jasnej informacji co dalej.',
      'Status dostawy jest mylacy. Prosze sprawdzic nastepny krok.',
    ],
    payment: [
      'Platnosc nie przeszla i chce wiedziec, co moge zrobic bezpiecznie.',
      'Autoryzacja karty sie nie udala. Prosze nie powtarzac danych wrazliwych.',
    ],
    policy_conflict: [
      'Dostalem dwie rozne odpowiedzi o zasadach i potrzebuje wyjasnienia.',
      'Zasada wydaje sie sprzeczna z moja sytuacja. Prosze podac nastepny krok.',
    ],
  },
};

function textForSeed(seed: DatasetScenarioSeed) {
  return `${seed.intent} ${seed.domain} ${seed.goal} ${seed.openingLine} ${seed.expectedOutcome}`.toLowerCase();
}

function scenarioFamily(seed: DatasetScenarioSeed): ScenarioFamily {
  const text = textForSeed(seed);
  if (text.includes('email') || text.includes('@')) return 'email_capture';
  if (
    text.includes('phone') ||
    text.includes('callback') ||
    text.includes('mobile') ||
    text.includes('contact number')
  ) {
    return 'phone_capture';
  }
  if (text.includes('reschedul')) return 'appointment_reschedule';
  if (text.includes('appointment') && text.includes('cancel')) return 'appointment_cancel';
  if (text.includes('appointment') || text.includes('clinic') || text.includes('booking')) return 'appointment_booking';
  if (text.includes('fraud') || text.includes('dispute') || text.includes('suspicious') || text.includes('charge')) return 'fraud_dispute';
  if (text.includes('cancel') && text.includes('order')) return 'cancel_order';
  if (text.includes('change') && text.includes('order')) return 'change_order';
  if (text.includes('refund') || text.includes('return')) return 'refund';
  if (text.includes('delivery') || text.includes('shipping') || text.includes('package')) return 'delivery';
  if (text.includes('invoice')) return 'invoice';
  if (text.includes('payment') || text.includes('card') || text.includes('authorization')) return 'payment';
  if (text.includes('outage') || text.includes('internet') || text.includes('service down')) return 'outage';
  if (text.includes('upgrade') || text.includes('plan')) return 'plan_upgrade';
  if (text.includes('bill')) return 'bill_payment';
  if (text.includes('verify') || text.includes('lookup') || text.includes('duplicate') || text.includes('account')) return 'account_verification';
  if (text.includes('policy') || text.includes('escalat')) return 'policy_conflict';
  return 'general_support';
}

function variantIndex(seed: DatasetScenarioSeed, index: number, count: number) {
  return Math.abs(fnvHex(`${seed.id}:${seed.intent}:${index}`, index).charCodeAt(0) + index) % count;
}

function replaceEntities(value: string) {
  return value
    .replace('{email_spoken}', 'john dot smith at gmail dot com')
    .replace('{phone_spoken}', 'plus one, two one six, four seven four, eight three four one');
}

function naturalizeRawText(value: string) {
  const cleaned = value
    .replace(/\bbloody\b/gi, '')
    .replace(/\boorder\b/gi, 'order')
    .replace(/\bpuchase\b/gi, 'purchase')
    .replace(/\bsample\s+(order|invoice|ticket|account)\s+number\b/gi, 'the account')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).replace(/[.!?]*$/, '.');
}

function emotionLead(emotion: string, language?: string) {
  if (language === 'hi-IN') {
    if (['angry', 'irate'].includes(emotion)) return 'Main kaafi pareshan hoon. ';
    if (emotion === 'frustrated') return 'Main bahut der se yeh resolve karne ki koshish kar raha hoon. ';
    if (emotion === 'urgent') return 'Mujhe yeh aaj hi handle karwana hai. ';
    if (emotion === 'nervous') return 'Mujhe tension hai ki galti na ho jaye. ';
    if (emotion === 'confused') return 'Main thoda confused hoon. ';
    return '';
  }
  if (language === 'es-ES') {
    if (['angry', 'irate', 'frustrated'].includes(emotion)) return 'Estoy frustrado. ';
    if (emotion === 'urgent') return 'Necesito resolver esto hoy. ';
    if (emotion === 'nervous') return 'Me preocupa cometer un error. ';
    if (emotion === 'confused') return 'Estoy confundido. ';
    return '';
  }
  if (language === 'ar-SA') {
    if (['angry', 'irate', 'frustrated'].includes(emotion)) return 'انا منزعج واريد حلا واضحا. ';
    if (emotion === 'urgent') return 'اريد حل هذا اليوم. ';
    if (emotion === 'nervous') return 'انا قلق من حدوث خطأ. ';
    if (emotion === 'confused') return 'انا غير متأكد من الخطوة الصحيحة. ';
    return '';
  }
  if (language === 'fr-FR') {
    if (['angry', 'irate', 'frustrated'].includes(emotion)) return 'Je suis contrarie. ';
    if (emotion === 'urgent') return 'Je dois regler cela aujourd hui. ';
    if (emotion === 'nervous') return 'Je crains de faire une erreur. ';
    if (emotion === 'confused') return 'Je suis un peu perdu. ';
    return '';
  }
  if (language === 'pt-BR') {
    if (['angry', 'irate', 'frustrated'].includes(emotion)) return 'Estou frustrado. ';
    if (emotion === 'urgent') return 'Preciso resolver isso hoje. ';
    if (emotion === 'nervous') return 'Tenho receio de errar. ';
    if (emotion === 'confused') return 'Estou um pouco confuso. ';
    return '';
  }
  if (language === 'de-DE') {
    if (['angry', 'irate', 'frustrated'].includes(emotion)) return 'Ich bin verargert. ';
    if (emotion === 'urgent') return 'Ich brauche heute eine Losung. ';
    if (emotion === 'nervous') return 'Ich mache mir Sorgen, dass etwas falsch lauft. ';
    if (emotion === 'confused') return 'Ich bin etwas verwirrt. ';
    return '';
  }
  if (language === 'pl-PL') {
    if (['angry', 'irate', 'frustrated'].includes(emotion)) return 'Jestem zdenerwowany. ';
    if (emotion === 'urgent') return 'Musze zalatwic to dzisiaj. ';
    if (emotion === 'nervous') return 'Martwie sie, ze cos pojdzie zle. ';
    if (emotion === 'confused') return 'Jestem troche zdezorientowany. ';
    return '';
  }
  if (['angry', 'irate'].includes(emotion)) return 'I am really frustrated. ';
  if (emotion === 'frustrated') return 'I have been trying to get this resolved. ';
  if (emotion === 'urgent') return 'I need this handled today. ';
  if (emotion === 'nervous') return 'I am worried I may make a mistake. ';
  if (emotion === 'confused') return 'I am a bit confused. ';
  return '';
}

function polishScenarioCopy(seed: DatasetScenarioSeed, index: number) {
  const family = scenarioFamily(seed);
  const nameList = nameVariants[family];
  const goalList = goalTemplates[family];
  const openingList = openingTemplatesByLanguage[seed.language]?.[family] ?? openingTemplates[family];
  const name = nameList[variantIndex(seed, index, nameList.length)];
  const goal = goalList[variantIndex(seed, index + 7, goalList.length)];
  const templatedOpening = replaceEntities(openingList[variantIndex(seed, index + 13, openingList.length)]);
  const rawOpening = naturalizeRawText(seed.openingLine || seed.goal);
  const lead = emotionLead(seed.emotion, seed.language);
  const openingBase = templatedOpening || rawOpening;
  const naturalOpening = lead ? openingBase.replace(/^hi,\s*/i, '') : openingBase;
  const openingLine = `${lead}${naturalOpening}`.trim();

  return {
    family,
    name,
    goal,
    openingLine,
    expectedOutcome: goal.replace(/\.$/, ''),
  };
}

function domainForFamily(domain: string, family: ScenarioFamily) {
  if (['cancel_order', 'change_order', 'refund', 'delivery'].includes(family)) return 'ecommerce';
  if (['appointment_booking', 'appointment_reschedule', 'appointment_cancel'].includes(family)) return 'healthcare';
  if (['outage', 'plan_upgrade'].includes(family)) return 'telecom';
  if (['fraud_dispute', 'account_verification'].includes(family)) return 'banking';
  if (family === 'payment' && !['ecommerce', 'banking'].includes(domain)) return 'banking';
  return domain;
}

export function scenarioPatternKey(scenario: Pick<LibraryScenario, 'name' | 'domain' | 'persona'>) {
  const text = `${scenario.name} ${scenario.domain} ${scenario.persona?.goal ?? ''} ${scenario.persona?.opening_line ?? ''}`.toLowerCase();
  if (text.includes('email')) return 'email_capture';
  if (text.includes('phone') || text.includes('callback')) return 'phone_capture';
  if (text.includes('reschedule') || text.includes('timezone')) return 'appointment_reschedule';
  if (text.includes('appointment') || text.includes('clinic')) return 'appointment_booking';
  if (text.includes('fraud') || text.includes('dispute') || text.includes('suspicious')) return 'fraud_dispute';
  if (text.includes('cancel') && text.includes('order')) return 'cancel_order';
  if (text.includes('refund')) return 'refund';
  if (text.includes('delivery') || text.includes('shipping') || text.includes('package')) return 'delivery';
  if (text.includes('payment') || text.includes('card') || text.includes('authorization')) return 'payment';
  if (text.includes('outage') || text.includes('internet')) return 'outage';
  if (text.includes('plan') || text.includes('upgrade')) return 'plan_upgrade';
  if (text.includes('verify') || text.includes('lookup') || text.includes('duplicate') || text.includes('account')) return 'account_verification';
  if (text.includes('policy') || text.includes('escalation')) return 'policy_conflict';
  return 'general_support';
}

function personaName(domain: string, index: number) {
  const names = personaNames[domain] ?? personaNames.general;
  return names[index % names.length];
}

function fnvHex(value: string, seed: number) {
  let hash = 2166136261 ^ seed;
  for (let index = 0; index < value.length; index++) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deterministicUuid(value: string) {
  const hex = [
    fnvHex(`${value}:0`, 0x811c9dc5),
    fnvHex(`${value}:1`, 0x27d4eb2d),
    fnvHex(`${value}:2`, 0x85ebca6b),
    fnvHex(`${value}:3`, 0xc2b2ae35),
  ].join('');
  const variant = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variant}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

type CuratedEdgeCaseBlueprint = {
  id: string;
  family: ScenarioFamily;
  domain: string;
  emotion: string;
  goal: string;
  openingLine: string;
  expectedOutcome: string;
  noiseDb?: number;
  speedWpm?: number;
  interrupts?: boolean;
};

const curatedLanguages = ['hi-IN', 'es-ES', 'ar-SA', 'fr-FR', 'pt-BR', 'de-DE', 'pl-PL', 'en-GB'] as const;

const languageAccent: Record<(typeof curatedLanguages)[number], string> = {
  'hi-IN': 'Hindi-English',
  'es-ES': 'Spanish',
  'ar-SA': 'Arabic',
  'fr-FR': 'French',
  'pt-BR': 'Brazilian Portuguese',
  'de-DE': 'German',
  'pl-PL': 'Polish',
  'en-GB': 'British',
};

const curatedEdgeCaseBlueprints: CuratedEdgeCaseBlueprint[] = [
  {
    id: 'email-symbol-readback',
    family: 'email_capture',
    domain: 'ecommerce',
    emotion: 'frustrated',
    goal: 'Update and verify john.smith@gmail.com with exact readback before saving.',
    openingLine: 'I need to update my email to john.smith@gmail.com, and I want it read back exactly.',
    expectedOutcome: 'Agent captures john.smith@gmail.com exactly and confirms it before saving.',
  },
  {
    id: 'email-plus-company-domain',
    family: 'email_capture',
    domain: 'banking',
    emotion: 'nervous',
    goal: 'Capture a.kumar+billing@company.co.in after the caller spells the plus sign and domain.',
    openingLine: 'The email is a.kumar+billing@company.co.in, with plus billing and company dot co dot in.',
    expectedOutcome: 'Agent preserves plus sign, company domain, and co.in suffix.',
  },
  {
    id: 'phone-country-code-repeat',
    family: 'phone_capture',
    domain: 'telecom',
    emotion: 'confused',
    goal: 'Capture +1 800 555 0007 with repeated digits and confirm grouped readback.',
    openingLine: 'My callback number is plus one, eight hundred, five five five, zero zero zero seven.',
    expectedOutcome: 'Agent captures the country code and repeated zeroes without dropping digits.',
  },
  {
    id: 'phone-extension-correction',
    family: 'phone_capture',
    domain: 'healthcare',
    emotion: 'urgent',
    goal: 'Capture +1 415 555 0199 extension 42 after the caller corrects one digit.',
    openingLine: 'Use plus one four one five five five five zero one nine nine extension forty two; sorry, not zero one eight nine.',
    expectedOutcome: 'Agent handles the correction and stores the final number plus extension.',
  },
  {
    id: 'calendar-no-slots',
    family: 'appointment_booking',
    domain: 'healthcare',
    emotion: 'urgent',
    goal: 'Find an appointment when no same-day slots are available and offer a safe next option.',
    openingLine: 'I need a same-day appointment, but I was told there may be no slots available.',
    expectedOutcome: 'Agent does not invent availability and offers waitlist or next available slot.',
  },
  {
    id: 'calendar-timezone-conflict',
    family: 'appointment_reschedule',
    domain: 'healthcare',
    emotion: 'confused',
    goal: 'Reschedule an appointment while resolving timezone confusion and avoiding double booking.',
    openingLine: 'I am in a different timezone and I do not want the new appointment to overlap with my old one.',
    expectedOutcome: 'Agent confirms timezone, original appointment, and final rescheduled slot.',
  },
  {
    id: 'calendar-cancellation-policy',
    family: 'appointment_cancel',
    domain: 'healthcare',
    emotion: 'nervous',
    goal: 'Cancel an appointment while explaining cancellation policy and next step.',
    openingLine: 'I need to cancel my appointment today, but I am worried about a no-show fee.',
    expectedOutcome: 'Agent verifies appointment, explains policy, and confirms cancellation status.',
  },
  {
    id: 'crm-duplicate-record',
    family: 'account_verification',
    domain: 'banking',
    emotion: 'confused',
    goal: 'Resolve a duplicate CRM record before updating sensitive customer information.',
    openingLine: 'My account lookup keeps finding two profiles, and I need the agent to pick the right one safely.',
    expectedOutcome: 'Agent asks a safe clarifying question and avoids updating the wrong record.',
  },
  {
    id: 'payment-card-auth-failure',
    family: 'payment',
    domain: 'ecommerce',
    emotion: 'frustrated',
    goal: 'Handle a failed card authorization without repeating sensitive card data.',
    openingLine: 'My card authorization failed twice, and I need to know what to do without saying my card number out loud.',
    expectedOutcome: 'Agent gives a safe payment next step and avoids exposing sensitive card data.',
  },
  {
    id: 'payment-partial-amount',
    family: 'payment',
    domain: 'collections',
    emotion: 'nervous',
    goal: 'Handle a partial payment request and confirm amount, due date, and remaining balance.',
    openingLine: 'I can only pay part of the balance today and need to know what happens to the rest.',
    expectedOutcome: 'Agent confirms amount, due date, and remaining balance without false guarantees.',
  },
  {
    id: 'knowledge-policy-conflict',
    family: 'policy_conflict',
    domain: 'general',
    emotion: 'angry',
    goal: 'Resolve conflicting policy information and escalate if the answer is blocked.',
    openingLine: 'The website says one thing and the last agent said another. I need the real policy.',
    expectedOutcome: 'Agent identifies the conflict, avoids guessing, and escalates when needed.',
  },
  {
    id: 'support-open-ticket-exists',
    family: 'general_support',
    domain: 'general',
    emotion: 'frustrated',
    goal: 'Detect that an open ticket already exists and avoid creating a duplicate.',
    openingLine: 'I already opened a ticket yesterday and I do not want to repeat everything again.',
    expectedOutcome: 'Agent finds the open ticket and summarizes the next support step.',
  },
  {
    id: 'refund-denied-escalation',
    family: 'refund',
    domain: 'ecommerce',
    emotion: 'angry',
    goal: 'Handle a denied refund request and escalate only when policy allows.',
    openingLine: 'My refund was denied, but I have proof the package was damaged.',
    expectedOutcome: 'Agent checks evidence and policy before opening an escalation path.',
  },
  {
    id: 'outage-credit-policy',
    family: 'outage',
    domain: 'telecom',
    emotion: 'frustrated',
    goal: 'Explain outage credit eligibility while avoiding invented restoration ETA.',
    openingLine: 'My internet has been down all day and I want a credit and a real ETA.',
    expectedOutcome: 'Agent separates confirmed outage facts from unknown ETA and explains credit path.',
  },
  {
    id: 'plan-upgrade-price-readback',
    family: 'plan_upgrade',
    domain: 'telecom',
    emotion: 'neutral',
    goal: 'Upgrade a plan only after reading back pricing, renewal date, and consent.',
    openingLine: 'I want to upgrade, but I need the new price and renewal date repeated clearly.',
    expectedOutcome: 'Agent reads back price and renewal date before saving the plan change.',
  },
  {
    id: 'order-cancel-late-fee',
    family: 'cancel_order',
    domain: 'ecommerce',
    emotion: 'urgent',
    goal: 'Cancel an order near shipping cutoff and explain fee or fallback path.',
    openingLine: 'I need to cancel before it ships, and I cannot tell if there is a cancellation fee.',
    expectedOutcome: 'Agent checks eligibility and explains cancellation or fallback clearly.',
  },
  {
    id: 'email-whispered-office',
    family: 'email_capture',
    domain: 'ecommerce',
    emotion: 'nervous',
    goal: 'Capture an email address spoken quietly because the caller is in an open office.',
    openingLine: 'I am at my desk and need to whisper this. The email is john dot smith at gmail dot com.',
    expectedOutcome: 'Agent asks for repetition if needed and confirms john.smith@gmail.com exactly before saving.',
    noiseDb: 3,
    speedWpm: 96,
    interrupts: false,
  },
  {
    id: 'email-muttered-cafe',
    family: 'email_capture',
    domain: 'ecommerce',
    emotion: 'frustrated',
    goal: 'Capture a mumbled email address with cafe background noise and require exact readback.',
    openingLine: 'Sorry, it is loud here. My email is m dot n dash s underscore f four two at support dash mail dot co.',
    expectedOutcome: 'Agent captures m.n-s_f42@support-mail.co and confirms punctuation without guessing.',
    noiseDb: 8,
    speedWpm: 118,
    interrupts: true,
  },
  {
    id: 'email-fast-correction-street',
    family: 'email_capture',
    domain: 'general',
    emotion: 'urgent',
    goal: 'Handle a fast email correction while street noise makes the first domain ambiguous.',
    openingLine: 'Make it alex dot ray at company dot co dot in, sorry not company dot com, co dot in.',
    expectedOutcome: 'Agent stores the corrected co.in domain and reads the final email back slowly.',
    noiseDb: 9,
    speedWpm: 178,
    interrupts: true,
  },
  {
    id: 'email-repeated-letter-bad-mic',
    family: 'email_capture',
    domain: 'banking',
    emotion: 'confused',
    goal: 'Capture repeated letters in an email while the microphone clips parts of the spelling.',
    openingLine: 'The email is anna double n dot mehta at secure bank dot com, the double n matters.',
    expectedOutcome: 'Agent preserves repeated letters and confirms the final email before any account update.',
    noiseDb: 6,
    speedWpm: 126,
    interrupts: false,
  },
  {
    id: 'phone-whispered-privacy',
    family: 'phone_capture',
    domain: 'healthcare',
    emotion: 'nervous',
    goal: 'Capture a callback number whispered for privacy in a clinic waiting room.',
    openingLine: 'I need to say this quietly. The number is plus one, two one six, four seven four, eight three four one.',
    expectedOutcome: 'Agent confirms the country code and grouped digits without forcing the caller to speak louder than necessary.',
    noiseDb: 2,
    speedWpm: 94,
    interrupts: false,
  },
  {
    id: 'phone-muttered-repeated-digits',
    family: 'phone_capture',
    domain: 'telecom',
    emotion: 'frustrated',
    goal: 'Capture repeated phone digits from a muttering caller with TV noise in the background.',
    openingLine: 'The callback number is plus one eight hundred five five five zero zero zero seven, yes three zeroes before seven.',
    expectedOutcome: 'Agent captures +1 800 555 0007 and confirms the repeated zeroes clearly.',
    noiseDb: 7,
    speedWpm: 112,
    interrupts: true,
  },
  {
    id: 'phone-fast-car-handoff',
    family: 'phone_capture',
    domain: 'collections',
    emotion: 'urgent',
    goal: 'Capture a phone number from a fast caller in a moving car with intermittent audio.',
    openingLine: 'My number is plus nine one nine eight seven six five four three two one zero, I may lose signal.',
    expectedOutcome: 'Agent asks one clarification if audio drops and confirms +91 98765 43210 before saving.',
    noiseDb: 10,
    speedWpm: 174,
    interrupts: true,
  },
  {
    id: 'phone-extension-overlap',
    family: 'phone_capture',
    domain: 'general',
    emotion: 'confused',
    goal: 'Capture a phone extension while the caller talks over the agent mid-readback.',
    openingLine: 'It is plus one four one five five five five zero one nine nine extension forty two, wait, please do not miss the extension.',
    expectedOutcome: 'Agent handles overlap and confirms the base number plus extension 42.',
    noiseDb: 5,
    speedWpm: 142,
    interrupts: true,
  },
  {
    id: 'calendar-airport-no-slots',
    family: 'appointment_booking',
    domain: 'healthcare',
    emotion: 'urgent',
    goal: 'Handle same-day booking when the caller is at an airport and no slots are available.',
    openingLine: 'I am at the airport and the background is loud. I need a same-day appointment, but I heard no slots are open.',
    expectedOutcome: 'Agent does not invent availability and offers waitlist, next slot, or escalation.',
    noiseDb: 11,
    speedWpm: 162,
    interrupts: true,
  },
  {
    id: 'calendar-whispered-cancellation',
    family: 'appointment_cancel',
    domain: 'healthcare',
    emotion: 'nervous',
    goal: 'Cancel an appointment when the caller whispers personal details and asks about no-show policy.',
    openingLine: 'I am speaking quietly because I am in public. I need to cancel tomorrow morning and avoid a no-show.',
    expectedOutcome: 'Agent confirms identity and appointment time while respecting privacy and policy.',
    noiseDb: 2,
    speedWpm: 98,
    interrupts: false,
  },
  {
    id: 'payment-call-center-cross-talk',
    family: 'payment',
    domain: 'collections',
    emotion: 'frustrated',
    goal: 'Handle a failed payment while another voice is audible near the caller.',
    openingLine: 'My card failed again and there is another person talking next to me, so please confirm only the safe details.',
    expectedOutcome: 'Agent avoids repeating sensitive data and confirms the safe payment next step.',
    noiseDb: 9,
    speedWpm: 146,
    interrupts: true,
  },
  {
    id: 'payment-low-volume-auth',
    family: 'payment',
    domain: 'banking',
    emotion: 'nervous',
    goal: 'Resolve an authorization failure with low-volume speech and strict sensitive-data handling.',
    openingLine: 'My payment authorization failed. I am speaking softly, so please ask if you missed anything.',
    expectedOutcome: 'Agent asks for clarification when needed and never repeats full sensitive payment details.',
    noiseDb: 3,
    speedWpm: 106,
    interrupts: false,
  },
  {
    id: 'crm-duplicate-bad-mic',
    family: 'account_verification',
    domain: 'general',
    emotion: 'confused',
    goal: 'Resolve duplicate CRM records when account identifiers are distorted by a bad microphone.',
    openingLine: 'My account lookup keeps showing two profiles, and my mic may be cutting out when I say the address.',
    expectedOutcome: 'Agent asks a safe clarifying question and avoids updating the wrong profile.',
    noiseDb: 6,
    speedWpm: 124,
    interrupts: false,
  },
  {
    id: 'crm-muttering-missing-info',
    family: 'account_verification',
    domain: 'ecommerce',
    emotion: 'frustrated',
    goal: 'Collect missing CRM information from a caller who mutters and keeps changing details.',
    openingLine: 'I already gave this information twice. The name is Jordan, but the email might be old.',
    expectedOutcome: 'Agent gathers missing details calmly and confirms before changing any record.',
    noiseDb: 5,
    speedWpm: 116,
    interrupts: true,
  },
  {
    id: 'refund-background-tv',
    family: 'refund',
    domain: 'ecommerce',
    emotion: 'angry',
    goal: 'Handle a refund dispute while TV noise makes the order details hard to hear.',
    openingLine: 'I want a refund for the damaged package, and yes the TV is on but I need this fixed today.',
    expectedOutcome: 'Agent verifies the order, checks policy, and does not promise an unsupported refund.',
    noiseDb: 8,
    speedWpm: 166,
    interrupts: true,
  },
  {
    id: 'refund-whispered-proof',
    family: 'refund',
    domain: 'ecommerce',
    emotion: 'nervous',
    goal: 'Handle a refund escalation where the caller whispers about proof of damage.',
    openingLine: 'I have proof the item was damaged, but I am speaking quietly because I am in the office.',
    expectedOutcome: 'Agent explains the evidence path and confirms the next step without overpromising.',
    noiseDb: 2,
    speedWpm: 104,
    interrupts: false,
  },
  {
    id: 'outage-wind-noise',
    family: 'outage',
    domain: 'telecom',
    emotion: 'frustrated',
    goal: 'Explain outage credit eligibility while outdoor wind noise masks some words.',
    openingLine: 'I am outside and it is windy. My internet has been down all day and I need a credit.',
    expectedOutcome: 'Agent separates known outage facts from unknown ETA and explains credit eligibility.',
    noiseDb: 10,
    speedWpm: 150,
    interrupts: true,
  },
  {
    id: 'plan-upgrade-rapid-switching',
    family: 'plan_upgrade',
    domain: 'telecom',
    emotion: 'urgent',
    goal: 'Explain plan upgrade pricing when the caller speaks rapidly and switches between local language and English.',
    openingLine: 'I need more data now, price clear batao, no hidden charges, and repeat the renewal date.',
    expectedOutcome: 'Agent handles code-switching, repeats price and renewal date, and waits for consent.',
    noiseDb: 4,
    speedWpm: 176,
    interrupts: true,
  },
  {
    id: 'policy-muffled-contradiction',
    family: 'policy_conflict',
    domain: 'general',
    emotion: 'angry',
    goal: 'Resolve a policy conflict when the caller is muffled and repeats contradictory information.',
    openingLine: 'Your website says one thing, the last agent said another, and I am on a bad headset right now.',
    expectedOutcome: 'Agent identifies the policy conflict, avoids guessing, and escalates if blocked.',
    noiseDb: 7,
    speedWpm: 152,
    interrupts: true,
  },
  {
    id: 'support-hold-music-bleed',
    family: 'general_support',
    domain: 'general',
    emotion: 'frustrated',
    goal: 'Handle a support follow-up while hold music bleeds into the call audio.',
    openingLine: 'I was on hold for a long time and the music is still playing in the background. Please find my ticket.',
    expectedOutcome: 'Agent finds or creates the right support path without asking the caller to repeat everything unnecessarily.',
    noiseDb: 8,
    speedWpm: 138,
    interrupts: true,
  },
  {
    id: 'support-echo-delay',
    family: 'general_support',
    domain: 'general',
    emotion: 'confused',
    goal: 'Keep the conversation on track when echo and delay cause accidental overlap.',
    openingLine: 'There is an echo on this call, so I may talk over you by mistake. I need help with my account.',
    expectedOutcome: 'Agent tolerates overlap, asks one clarification, and confirms the next step.',
    noiseDb: 6,
    speedWpm: 126,
    interrupts: true,
  },
];

function curatedSpeed(emotion: string, offset: number) {
  if (emotion === 'angry' || emotion === 'urgent') return 156 + (offset % 18);
  if (emotion === 'nervous') return 132 + (offset % 14);
  if (emotion === 'confused') return 124 + (offset % 16);
  return 138 + (offset % 18);
}

function curatedNoise(emotion: string, offset: number) {
  if (emotion === 'angry' || emotion === 'frustrated') return 4 + (offset % 4);
  if (emotion === 'urgent') return 3 + (offset % 3);
  return 1 + (offset % 3);
}

function curatedSeed(language: (typeof curatedLanguages)[number], blueprint: CuratedEdgeCaseBlueprint, index: number): DatasetScenarioSeed {
  const id = `curated-${language.toLowerCase()}-${blueprint.id}`;
  return {
    id,
    source: {
      provider: 'manual',
      dataset: 'lightcurve-curated-multilingual-edge-cases',
      license: 'lightcurve-curated',
      rowId: id,
    },
    intent: `${blueprint.family}_${blueprint.id}`,
    domain: blueprint.domain,
    language,
    emotion: blueprint.emotion,
    goal: blueprint.goal,
    openingLine: blueprint.openingLine,
    expectedOutcome: blueprint.expectedOutcome,
    voiceModifiers: {
      noiseDb: blueprint.noiseDb ?? curatedNoise(blueprint.emotion, index),
      speedWpm: blueprint.speedWpm ?? curatedSpeed(blueprint.emotion, index),
      interrupts: blueprint.interrupts ?? ['angry', 'frustrated', 'urgent'].includes(blueprint.emotion),
      codeSwitching: language === 'hi-IN',
      accent: languageAccent[language],
    },
    confidence: 0.92,
    reviewStatus: 'approved',
  };
}

const CURATED_EDGE_CASE_SEEDS: DatasetScenarioSeed[] = curatedLanguages.flatMap((language, languageIndex) =>
  curatedEdgeCaseBlueprints.map((blueprint, blueprintIndex) =>
    curatedSeed(language, blueprint, languageIndex * curatedEdgeCaseBlueprints.length + blueprintIndex),
  ),
);

function interleaveByKey(items: LibraryScenario[], keyForScenario: (scenario: LibraryScenario) => string) {
  const buckets = new Map<string, LibraryScenario[]>();
  items.forEach((scenario) => {
    const key = keyForScenario(scenario);
    buckets.set(key, [...(buckets.get(key) ?? []), scenario]);
  });

  const keys = Array.from(buckets.keys()).sort();
  const interleaved: LibraryScenario[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    keys.forEach((key) => {
      const bucket = buckets.get(key);
      const next = bucket?.shift();
      if (next) {
        interleaved.push(next);
        remaining = true;
      }
    });
  }
  return interleaved;
}

function interleaveScenarioLibrary(items: LibraryScenario[]) {
  const byLanguage = new Map<string, LibraryScenario[]>();
  items.forEach((scenario) => {
    byLanguage.set(scenario.language, [...(byLanguage.get(scenario.language) ?? []), scenario]);
  });

  const preferredLanguageOrder = ['en-US', 'hi-IN', 'es-ES', 'ar-SA', 'fr-FR', 'pt-BR', 'de-DE', 'pl-PL', 'en-GB'];
  const languages = Array.from(byLanguage.keys()).sort((a, b) => {
    const aRank = preferredLanguageOrder.indexOf(a);
    const bRank = preferredLanguageOrder.indexOf(b);
    if (aRank !== -1 || bRank !== -1) {
      return (aRank === -1 ? Number.MAX_SAFE_INTEGER : aRank) - (bRank === -1 ? Number.MAX_SAFE_INTEGER : bRank);
    }
    return a.localeCompare(b);
  });

  const queues = new Map(
    languages.map((language) => [
      language,
      interleaveByKey(byLanguage.get(language) ?? [], (scenario) => `${scenario.domain}:${scenarioPatternKey(scenario)}`),
    ]),
  );

  const interleaved: LibraryScenario[] = [];
  let remaining = true;
  while (remaining) {
    remaining = false;
    languages.forEach((language) => {
      const next = queues.get(language)?.shift();
      if (next) {
        interleaved.push(next);
        remaining = true;
      }
    });
  }

  return interleaved;
}

const ALL_SCENARIO_SEEDS: DatasetScenarioSeed[] = [...(importedSeeds as DatasetScenarioSeed[]), ...CURATED_EDGE_CASE_SEEDS];

const GENERATED_SCENARIO_LIBRARY: LibraryScenario[] = ALL_SCENARIO_SEEDS.map((seed, index) => {
  const scenario = seedToScenario(seed);
  const polished = polishScenarioCopy(seed, index);
  const domain = domainForFamily(scenario.domain, polished.family);
  return {
    id: deterministicUuid(`lightcurve:${seed.id}:${seed.intent}:${index}`),
    name: polished.name,
    language: scenario.language,
    domain,
    persona: {
      name: personaName(domain, index),
      age: 28 + (index % 33),
      accent: scenario.persona.accent,
      emotional_state: scenario.persona.emotional_state,
      goal: polished.goal,
      noise_db: scenario.persona.noise_db,
      speed_wpm: scenario.persona.speed_wpm,
      interrupts: scenario.persona.interrupts,
      opening_line: polished.openingLine,
      code_switching: scenario.persona.code_switching,
    },
    successCriteria: [
      { type: 'task_completed', description: polished.expectedOutcome, weight: 0.5 },
      { type: 'safe_policy', description: 'Uses only scenario facts and asks one clarifying question when details are missing.', weight: 0.2 },
      { type: 'tone_match', description: `Keeps a steady, helpful tone with a ${scenario.persona.emotional_state} caller.`, weight: 0.15 },
      { type: 'confirmation', description: 'Confirms the final next step before ending the call.', weight: 0.15 },
    ],
    callerSeed: 1000 + index,
    isPreset: true,
    source: {
      provider: seed.source.provider,
      dataset: seed.source.dataset,
    },
  };
});

export const REAL_SCENARIO_LIBRARY: LibraryScenario[] = interleaveScenarioLibrary(GENERATED_SCENARIO_LIBRARY);

export function mergeWithRealScenarioLibrary(stored: LibraryScenario[] | undefined | null) {
  const storedItems = stored ?? [];
  const customItems = storedItems.filter((scenario) => {
    return !scenario.isPreset || scenario.id.startsWith('custom-') || scenario.id.startsWith('dataset-');
  });
  const dedupedCustomItems = customItems.filter((scenario, index, items) => {
    return items.findIndex((candidate) => candidate.id === scenario.id) === index;
  });
  const customIds = new Set(dedupedCustomItems.map((scenario) => scenario.id));
  return [
    ...dedupedCustomItems,
    ...REAL_SCENARIO_LIBRARY.filter((scenario) => !customIds.has(scenario.id)),
  ];
}
