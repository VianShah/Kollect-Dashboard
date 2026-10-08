import { FALLBACK_LANGUAGE } from "./languages";

export type TemplateName = "EMI reminder" | "Payment link" | "PTP reminder" | "Overdue notice";
export interface MessageVars { first: string; product: string; amt: string; link: string; dpd: number; lender: string }

type Pack = Record<TemplateName, (v: MessageVars) => string> & { stop: string };

// Borrower-facing wording. Have a native speaker for each language approve these before they go live.
const PACKS: Record<string, Pack> = {
  English: {
    "EMI reminder": (v) => `Hi ${v.first}, your ${v.product} EMI of ${v.amt} is due on the 5th.`,
    "Payment link": (v) => `Hi ${v.first}, pay your ${v.amt} ${v.product} EMI securely: ${v.link}`,
    "PTP reminder": (v) => `Hi ${v.first}, a reminder of your promise to pay ${v.amt}. Pay here: ${v.link}`,
    "Overdue notice": (v) => `Hi ${v.first}, your ${v.product} account is ${v.dpd} days overdue. Please pay ${v.amt} to avoid further charges.`,
    stop: "Reply STOP to opt out.",
  },
  Hindi: {
    "EMI reminder": (v) => `नमस्ते ${v.first}, आपकी ${v.product} की ${v.amt} की EMI 5 तारीख को देय है।`,
    "Payment link": (v) => `नमस्ते ${v.first}, अपनी ${v.amt} की ${v.product} EMI सुरक्षित रूप से यहाँ चुकाएँ: ${v.link}`,
    "PTP reminder": (v) => `नमस्ते ${v.first}, आपके ${v.amt} भुगतान के वादे की याद दिलाना चाहते हैं। यहाँ भुगतान करें: ${v.link}`,
    "Overdue notice": (v) => `नमस्ते ${v.first}, आपका ${v.product} खाता ${v.dpd} दिन से बकाया है। अतिरिक्त शुल्क से बचने के लिए कृपया ${v.amt} चुकाएँ।`,
    stop: "सूचनाएँ बंद करने के लिए STOP भेजें।",
  },
  Marathi: {
    "EMI reminder": (v) => `नमस्कार ${v.first}, तुमच्या ${v.product} चा ${v.amt} चा EMI 5 तारखेला देय आहे.`,
    "Payment link": (v) => `नमस्कार ${v.first}, तुमचा ${v.amt} चा ${v.product} EMI सुरक्षितपणे येथे भरा: ${v.link}`,
    "PTP reminder": (v) => `नमस्कार ${v.first}, तुम्ही ${v.amt} भरण्याचे दिलेले वचन आठवण करून देत आहोत. येथे भरा: ${v.link}`,
    "Overdue notice": (v) => `नमस्कार ${v.first}, तुमचे ${v.product} खाते ${v.dpd} दिवसांपासून थकीत आहे. अतिरिक्त शुल्क टाळण्यासाठी कृपया ${v.amt} भरा.`,
    stop: "संदेश थांबवण्यासाठी STOP पाठवा.",
  },
  Gujarati: {
    "EMI reminder": (v) => `નમસ્તે ${v.first}, તમારી ${v.product} ની ${v.amt} ની EMI 5 તારીખે બાકી છે.`,
    "Payment link": (v) => `નમસ્તે ${v.first}, તમારી ${v.amt} ની ${v.product} EMI અહીં સુરક્ષિત રીતે ચૂકવો: ${v.link}`,
    "PTP reminder": (v) => `નમસ્તે ${v.first}, તમે ${v.amt} ચૂકવવાનું વચન આપ્યું હતું તેની યાદ અપાવીએ છીએ. અહીં ચૂકવો: ${v.link}`,
    "Overdue notice": (v) => `નમસ્તે ${v.first}, તમારું ${v.product} ખાતું ${v.dpd} દિવસથી બાકી છે. વધારાના ચાર્જથી બચવા કૃપા કરીને ${v.amt} ચૂકવો.`,
    stop: "સંદેશા બંધ કરવા STOP મોકલો.",
  },
  Tamil: {
    "EMI reminder": (v) => `வணக்கம் ${v.first}, உங்கள் ${v.product} க்கான ${v.amt} EMI 5ஆம் தேதி செலுத்த வேண்டியுள்ளது.`,
    "Payment link": (v) => `வணக்கம் ${v.first}, உங்கள் ${v.amt} ${v.product} EMI-ஐ பாதுகாப்பாக இங்கே செலுத்துங்கள்: ${v.link}`,
    "PTP reminder": (v) => `வணக்கம் ${v.first}, ${v.amt} செலுத்துவதாக நீங்கள் அளித்த வாக்குறுதியை நினைவூட்டுகிறோம். இங்கே செலுத்துங்கள்: ${v.link}`,
    "Overdue notice": (v) => `வணக்கம் ${v.first}, உங்கள் ${v.product} கணக்கு ${v.dpd} நாட்களாக நிலுவையில் உள்ளது. கூடுதல் கட்டணத்தைத் தவிர்க்க ${v.amt} செலுத்தவும்.`,
    stop: "செய்திகளை நிறுத்த STOP என அனுப்பவும்.",
  },
  Telugu: {
    "EMI reminder": (v) => `నమస్కారం ${v.first}, మీ ${v.product} ${v.amt} EMI 5వ తేదీన చెల్లించాల్సి ఉంది.`,
    "Payment link": (v) => `నమస్కారం ${v.first}, మీ ${v.amt} ${v.product} EMI ని ఇక్కడ సురక్షితంగా చెల్లించండి: ${v.link}`,
    "PTP reminder": (v) => `నమస్కారం ${v.first}, మీరు ${v.amt} చెల్లిస్తామని ఇచ్చిన మాటను గుర్తుచేస్తున్నాము. ఇక్కడ చెల్లించండి: ${v.link}`,
    "Overdue notice": (v) => `నమస్కారం ${v.first}, మీ ${v.product} ఖాతా ${v.dpd} రోజులుగా బకాయిలో ఉంది. అదనపు రుసుములు నివారించడానికి దయచేసి ${v.amt} చెల్లించండి.`,
    stop: "సందేశాలు ఆపడానికి STOP అని పంపండి.",
  },
  Kannada: {
    "EMI reminder": (v) => `ನಮಸ್ಕಾರ ${v.first}, ನಿಮ್ಮ ${v.product} ನ ${v.amt} EMI 5ನೇ ತಾರೀಖಿಗೆ ಬಾಕಿ ಇದೆ.`,
    "Payment link": (v) => `ನಮಸ್ಕಾರ ${v.first}, ನಿಮ್ಮ ${v.amt} ${v.product} EMI ಅನ್ನು ಇಲ್ಲಿ ಸುರಕ್ಷಿತವಾಗಿ ಪಾವತಿಸಿ: ${v.link}`,
    "PTP reminder": (v) => `ನಮಸ್ಕಾರ ${v.first}, ನೀವು ${v.amt} ಪಾವತಿಸುವುದಾಗಿ ನೀಡಿದ ಭರವಸೆಯನ್ನು ನೆನಪಿಸುತ್ತಿದ್ದೇವೆ. ಇಲ್ಲಿ ಪಾವತಿಸಿ: ${v.link}`,
    "Overdue notice": (v) => `ನಮಸ್ಕಾರ ${v.first}, ನಿಮ್ಮ ${v.product} ಖಾತೆ ${v.dpd} ದಿನಗಳಿಂದ ಬಾಕಿ ಇದೆ. ಹೆಚ್ಚುವರಿ ಶುಲ್ಕ ತಪ್ಪಿಸಲು ದಯವಿಟ್ಟು ${v.amt} ಪಾವತಿಸಿ.`,
    stop: "ಸಂದೇಶಗಳನ್ನು ನಿಲ್ಲಿಸಲು STOP ಕಳುಹಿಸಿ.",
  },
  Bengali: {
    "EMI reminder": (v) => `নমস্কার ${v.first}, আপনার ${v.product} এর ${v.amt} EMI 5 তারিখে দেয়।`,
    "Payment link": (v) => `নমস্কার ${v.first}, আপনার ${v.amt} ${v.product} EMI এখানে নিরাপদে পরিশোধ করুন: ${v.link}`,
    "PTP reminder": (v) => `নমস্কার ${v.first}, আপনি ${v.amt} পরিশোধের যে প্রতিশ্রুতি দিয়েছিলেন তা মনে করিয়ে দিচ্ছি। এখানে পরিশোধ করুন: ${v.link}`,
    "Overdue notice": (v) => `নমস্কার ${v.first}, আপনার ${v.product} অ্যাকাউন্ট ${v.dpd} দিন ধরে বকেয়া। অতিরিক্ত চার্জ এড়াতে অনুগ্রহ করে ${v.amt} পরিশোধ করুন।`,
    stop: "বার্তা বন্ধ করতে STOP পাঠান।",
  },
  Malayalam: {
    "EMI reminder": (v) => `നമസ്കാരം ${v.first}, നിങ്ങളുടെ ${v.product} ന്റെ ${v.amt} EMI 5-ാം തീയതി അടയ്ക്കണം.`,
    "Payment link": (v) => `നമസ്കാരം ${v.first}, നിങ്ങളുടെ ${v.amt} ${v.product} EMI ഇവിടെ സുരക്ഷിതമായി അടയ്ക്കുക: ${v.link}`,
    "PTP reminder": (v) => `നമസ്കാരം ${v.first}, ${v.amt} അടയ്ക്കാമെന്ന് നിങ്ങൾ നൽകിയ വാഗ്ദാനം ഓർമ്മിപ്പിക്കുന്നു. ഇവിടെ അടയ്ക്കുക: ${v.link}`,
    "Overdue notice": (v) => `നമസ്കാരം ${v.first}, നിങ്ങളുടെ ${v.product} അക്കൗണ്ട് ${v.dpd} ദിവസമായി കുടിശ്ശികയാണ്. അധിക ചാർജ് ഒഴിവാക്കാൻ ദയവായി ${v.amt} അടയ്ക്കുക.`,
    stop: "സന്ദേശങ്ങൾ നിർത്താൻ STOP അയയ്ക്കുക.",
  },
  Punjabi: {
    "EMI reminder": (v) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${v.first}, ਤੁਹਾਡੀ ${v.product} ਦੀ ${v.amt} ਦੀ EMI 5 ਤਰੀਕ ਨੂੰ ਬਕਾਇਆ ਹੈ।`,
    "Payment link": (v) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${v.first}, ਆਪਣੀ ${v.amt} ਦੀ ${v.product} EMI ਇੱਥੇ ਸੁਰੱਖਿਅਤ ਤਰੀਕੇ ਨਾਲ ਭਰੋ: ${v.link}`,
    "PTP reminder": (v) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${v.first}, ਤੁਸੀਂ ${v.amt} ਭਰਨ ਦਾ ਜੋ ਵਾਅਦਾ ਕੀਤਾ ਸੀ ਉਸ ਦੀ ਯਾਦ ਦਿਵਾਉਂਦੇ ਹਾਂ। ਇੱਥੇ ਭਰੋ: ${v.link}`,
    "Overdue notice": (v) => `ਸਤ ਸ੍ਰੀ ਅਕਾਲ ${v.first}, ਤੁਹਾਡਾ ${v.product} ਖਾਤਾ ${v.dpd} ਦਿਨਾਂ ਤੋਂ ਬਕਾਇਆ ਹੈ। ਵਾਧੂ ਖਰਚਿਆਂ ਤੋਂ ਬਚਣ ਲਈ ਕਿਰਪਾ ਕਰਕੇ ${v.amt} ਭਰੋ।`,
    stop: "ਸੁਨੇਹੇ ਬੰਦ ਕਰਨ ਲਈ STOP ਭੇਜੋ।",
  },
};

/** Borrower-facing text in the borrower's language. Always names the lender and says how to opt out. */
export function renderMessage(template: TemplateName, language: string, v: MessageVars): { text: string; language: string } {
  const lang = PACKS[language] ? language : FALLBACK_LANGUAGE;
  const pack = PACKS[lang];
  return { text: `${pack[template](v)} ${v.lender}. ${pack.stop}`, language: lang };
}

export const HAS_TEMPLATES = (language: string) => !!PACKS[language];
