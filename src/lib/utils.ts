const FIRST_NAMES = [
  "james","john","robert","michael","william","david","richard","joseph","thomas","charles",
  "mary","patricia","jennifer","linda","barbara","elizabeth","susan","jessica","sarah","karen",
  "alex","chris","jordan","taylor","morgan","riley","jamie","avery","emma","liam",
  "noah","olivia","sophia","lucas","mason","ethan","ava","jack","lily","ryan",
  "grace","owen","zoe","evan","chloe","sean","maya","anna","leo","mia",
  "daniel","matthew","andrew","joshua","samuel","benjamin","henry","luke","nathan","adam",
  "emily","alice","claire","diana","eleanor","fiona","georgia","hannah","iris","julia",
];

const LAST_NAMES = [
  "smith","johnson","williams","brown","jones","garcia","miller","davis","wilson","moore",
  "taylor","anderson","thomas","jackson","white","harris","martin","thompson","young","allen",
  "king","wright","scott","green","baker","adams","nelson","carter","mitchell","perez",
  "lee","walker","hall","lewis","robinson","clark","rodriguez","martinez","hill","turner",
  "parker","evans","edwards","collins","stewart","morris","rogers","cook","morgan","bell",
];

const ADJECTIVES = [
  "bright","swift","clear","soft","deep","calm","warm","cool","bold","fresh",
  "light","sharp","quiet","smooth","clean","strong","free","wide","open","pure",
  "quick","smart","gentle","grand","noble","proud","brave","wise","kind","glad",
  "fair","firm","keen","mild","neat","rich","safe","tall","true","vast",
];

const NOUNS = [
  "stone","leaf","brook","field","peak","grove","coast","river","cloud","wind",
  "trail","ridge","lake","creek","dawn","pine","oak","reed","moss","gate",
  "bridge","path","tower","shore","haven","vale","crest","bay","glen","hill",
  "wood","fern","rose","sage","tide","mist","cape","dell","ford","knoll",
];

function rand<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function randYear(): string {
  // Realistic birth years: 1975–2000
  return String(1975 + Math.floor(Math.random() * 26));
}

function randSmallNum(): string {
  // Small suffix number: 1–99
  return String(Math.floor(Math.random() * 99) + 1);
}

// Six natural patterns, each weighted equally
export function generateNamePrefix(): string {
  const pattern = Math.floor(Math.random() * 6);
  const first = rand(FIRST_NAMES);
  const last = rand(LAST_NAMES);
  const adj = rand(ADJECTIVES);
  const noun = rand(NOUNS);

  switch (pattern) {
    case 0: // johnsmith  — firstname+lastname
      return `${first}${last}`;
    case 1: // sarah1988  — firstname+birthyear
      return `${first}${randYear()}`;
    case 2: // smithj     — lastname+first-initial
      return `${last}${first[0]}`;
    case 3: // jasonleaf  — firstname+noun
      return `${first}${noun}`;
    case 4: // brightstone — adj+noun (current style)
      return `${adj}${noun}`;
    case 5: // clearbrook7 — adj+noun+small number
      return `${adj}${noun}${randSmallNum()}`;
    default:
      return `${first}${last}`;
  }
}

// Generate several prefix options for the quick-pick list
export function generatePrefixOptions(): { label: string; value: string }[] {
  return Array.from({ length: 5 }, () => {
    const v = generateNamePrefix();
    return { label: v, value: v };
  });
}

// Generate a random email prefix (pure random chars, kept for compatibility)
export function generatePrefix(length = 8): string {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  return Array.from({ length }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

// Pick a random domain from the list
export function randomDomain(domains: string[]): string {
  return domains[Math.floor(Math.random() * domains.length)];
}

// Extract links from HTML email body
export function extractLinks(html: string): { text: string; url: string }[] {
  const links: { text: string; url: string }[] = [];
  const regex = /<a\s+[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = regex.exec(html)) !== null) {
    const url = match[1];
    const text = match[2].replace(/<[^>]*>/g, "").trim();
    if (url && !url.startsWith("mailto:") && !url.startsWith("tel:") && !url.startsWith("#")) {
      links.push({ text: text || url, url });
    }
  }
  return links;
}

// Extract verification codes from text
export function extractCodes(text: string): string[] {
  const codes: string[] = [];
  const patterns = [
    /验证码[是为：:\s]*(\d{4,8})/g,
    /code[:\s]*(\d{4,8})/gi,
    /verification[:\s]*(\d{4,8})/gi,
    /(?:^|\s)(\d{4,8})(?:\s|$|[，。,.])/g,
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      if (!codes.includes(match[1])) codes.push(match[1]);
    }
  }
  return codes;
}

// Format date
export function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now.getTime() - date.getTime();

  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;

  return date.toLocaleDateString("zh-CN", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}
