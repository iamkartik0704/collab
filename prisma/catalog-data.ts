/**
 * Demo catalogue for local development and staging: real product names with original SVG
 * artwork (scripts/generate-product-art.ts) - no third-party product photography.
 * Prices are whole rupees here and converted to paise by the seed.
 */

export type ArtKind =
  | "phone"
  | "android"
  | "foldable"
  | "laptop"
  | "desktop"
  | "tablet"
  | "watch"
  | "camera"
  | "headphones"
  | "earbuds"
  | "console"
  | "tower"
  | "controller"
  | "vr";

export interface SeedVariant {
  color: string;
  hex: string;
  storageGb?: number;
  ramGb?: number;
  price: number;
  mrp?: number;
  stock: number;
}

export interface SeedProduct {
  slug: string;
  name: string;
  brand: string;
  category: "phones" | "computers" | "smart-watches" | "cameras" | "headphones" | "gaming";
  kind: ArtKind;
  summary: string;
  description: string;
  featured?: boolean;
  daysAgo: number;
  sales: number;
  warrantyMonths?: number;
  specs: Record<string, Record<string, string>>;
  highlights: Array<{ icon: "screen" | "cpu" | "cores" | "camera" | "front-camera" | "battery" | "storage" | "weight" | "display"; label: string; value: string }>;
  variants: SeedVariant[];
}

export const BRANDS: Record<string, string> = {
  apple: "Apple",
  samsung: "Samsung",
  google: "Google",
  oneplus: "OnePlus",
  xiaomi: "Xiaomi",
  dell: "Dell",
  lenovo: "Lenovo",
  garmin: "Garmin",
  sony: "Sony",
  canon: "Canon",
  fujifilm: "Fujifilm",
  bose: "Bose",
  microsoft: "Microsoft",
  meta: "Meta",
};

/** Filterable spec facets per category (Category.specTemplate). */
export const SPEC_TEMPLATES: Record<SeedProduct["category"], { facets: Array<{ key: string; label: string; group: string; field: string }> }> = {
  phones: {
    facets: [
      { key: "screen", label: "Screen size", group: "Display", field: "Screen size" },
      { key: "battery", label: "Battery capacity", group: "Battery", field: "Battery capacity" },
      { key: "cpu", label: "Processor", group: "Processor & GPU", field: "Processor" },
    ],
  },
  computers: {
    facets: [
      { key: "screen", label: "Screen size", group: "Display", field: "Screen size" },
      { key: "cpu", label: "Processor", group: "Processor & GPU", field: "Processor" },
    ],
  },
  "smart-watches": {
    facets: [
      { key: "case", label: "Case size", group: "Display", field: "Case size" },
      { key: "battery", label: "Battery life", group: "Battery", field: "Battery life" },
    ],
  },
  cameras: {
    facets: [
      { key: "sensor", label: "Sensor", group: "Sensor", field: "Sensor type" },
      { key: "resolution", label: "Resolution", group: "Sensor", field: "Resolution" },
    ],
  },
  headphones: {
    facets: [
      { key: "type", label: "Type", group: "Audio", field: "Type" },
      { key: "battery", label: "Battery life", group: "Battery", field: "Battery life" },
    ],
  },
  gaming: {
    facets: [{ key: "platform", label: "Platform", group: "General", field: "Platform" }],
  },
};

// ---------------------------------------------------------------- spec builders
function phoneSpecs(o: { screen: string; resolution: string; refresh: string; ppi: string; panel: string; cpu: string; cores: string; gpu: string; ram: string; storage: string; main: string; front: string; battery: string; charging: string; network: string; extras: string }) {
  return {
    Display: { "Screen size": o.screen, Resolution: o.resolution, "Refresh rate": o.refresh, "Pixel density": o.ppi, "Screen type": o.panel },
    "Processor & GPU": { Processor: o.cpu, "CPU cores": o.cores, GPU: o.gpu },
    Memory: { RAM: o.ram, "Storage options": o.storage },
    Camera: { "Main camera": o.main, "Front camera": o.front },
    Battery: { "Battery capacity": o.battery, Charging: o.charging },
    Connectivity: { Network: o.network, "Wi-Fi": "Wi-Fi 6E", Bluetooth: "5.3", NFC: "Yes" },
    "Box Contents": { "In the box": o.extras },
  };
}

function phoneHighlights(o: { screen: string; cpu: string; cores: string; main: string; front: string; battery: string }) {
  return [
    { icon: "screen" as const, label: "Screen size", value: o.screen },
    { icon: "cpu" as const, label: "CPU", value: o.cpu },
    { icon: "cores" as const, label: "Number of Cores", value: o.cores },
    { icon: "camera" as const, label: "Main camera", value: o.main },
    { icon: "front-camera" as const, label: "Front-camera", value: o.front },
    { icon: "battery" as const, label: "Battery capacity", value: o.battery },
  ];
}

function laptopSpecs(o: { screen: string; resolution: string; panel: string; cpu: string; cores: string; gpu: string; ram: string; storage: string; battery: string; weight: string; ports: string }) {
  return {
    Display: { "Screen size": o.screen, Resolution: o.resolution, "Screen type": o.panel },
    "Processor & GPU": { Processor: o.cpu, "CPU cores": o.cores, GPU: o.gpu },
    Memory: { RAM: o.ram, "Storage options": o.storage },
    Battery: { "Battery life": o.battery },
    Connectivity: { Ports: o.ports, "Wi-Fi": "Wi-Fi 6E", Bluetooth: "5.3" },
    General: { Weight: o.weight },
    "Box Contents": { "In the box": "Laptop, USB-C power adapter, charging cable, documentation" },
  };
}

function laptopHighlights(o: { screen: string; cpu: string; cores: string; storage: string; battery: string; weight: string }) {
  return [
    { icon: "display" as const, label: "Screen size", value: o.screen },
    { icon: "cpu" as const, label: "CPU", value: o.cpu },
    { icon: "cores" as const, label: "Number of Cores", value: o.cores },
    { icon: "storage" as const, label: "Storage", value: o.storage },
    { icon: "battery" as const, label: "Battery life", value: o.battery },
    { icon: "weight" as const, label: "Weight", value: o.weight },
  ];
}

const audioSpecs = (o: { type: string; anc: string; battery: string; driver: string; codecs: string; weight: string; box: string }) => ({
  Audio: { Type: o.type, "Noise cancellation": o.anc, Driver: o.driver, Codecs: o.codecs },
  Battery: { "Battery life": o.battery },
  Connectivity: { Bluetooth: "5.3", Multipoint: "Yes" },
  General: { Weight: o.weight },
  "Box Contents": { "In the box": o.box },
});

const watchSpecs = (o: { caseSize: string; display: string; chip: string; battery: string; water: string; sensors: string; box: string }) => ({
  Display: { "Case size": o.caseSize, "Screen type": o.display },
  "Processor & GPU": { Processor: o.chip },
  Battery: { "Battery life": o.battery },
  Health: { Sensors: o.sensors, "Water resistance": o.water },
  "Box Contents": { "In the box": o.box },
});

const cameraSpecs = (o: { sensor: string; resolution: string; video: string; iso: string; af: string; ibis: string; battery: string; weight: string }) => ({
  Sensor: { "Sensor type": o.sensor, Resolution: o.resolution, "ISO range": o.iso },
  Video: { "Max video": o.video },
  Focus: { Autofocus: o.af, Stabilisation: o.ibis },
  Battery: { "Battery life": o.battery },
  General: { Weight: o.weight },
  "Box Contents": { "In the box": "Body, battery, charger, strap, body cap" },
});

const gamingSpecs = (o: { platform: string; cpu: string; gpu: string; storage: string; output: string; box: string }) => ({
  General: { Platform: o.platform },
  "Processor & GPU": { Processor: o.cpu, GPU: o.gpu },
  Memory: { Storage: o.storage },
  Connectivity: { Output: o.output, "Wi-Fi": "Wi-Fi 6", Bluetooth: "5.1" },
  "Box Contents": { "In the box": o.box },
});

// ---------------------------------------------------------------- catalogue
export const PRODUCTS: SeedProduct[] = [
  // ============================== Phones
  {
    slug: "iphone-14-pro",
    name: "Apple iPhone 14 Pro",
    brand: "apple",
    category: "phones",
    kind: "phone",
    featured: true,
    daysAgo: 40,
    sales: 940,
    summary:
      "Enhanced capabilities thanks to an enlarged display of 6.1 inches and high-resolution Super Retina XDR panel with Always-On and ProMotion. Dynamic Island, a 48MP main camera and the A16 Bionic chip make it a true pro.",
    description:
      "Just as a book is judged by its cover, the first thing you notice when you pick up iPhone 14 Pro is the build: surgical-grade stainless steel and textured matte glass. The Dynamic Island bubbles up alerts and Live Activities, the 48MP Main camera captures 4x the resolution, and Crash Detection can call for help when you can't.",
    specs: phoneSpecs({ screen: "6.1\"", resolution: "2556 x 1179", refresh: "120 Hz", ppi: "460 ppi", panel: "Super Retina XDR OLED", cpu: "Apple A16 Bionic", cores: "6", gpu: "Apple 5-core", ram: "6 GB", storage: "128GB / 256GB / 512GB / 1TB", main: "48-12-12 MP", front: "12 MP", battery: "3200 mAh", charging: "20W wired, 15W MagSafe", network: "5G", extras: "iPhone, USB-C to Lightning cable, documentation" }),
    highlights: phoneHighlights({ screen: "6.1\"", cpu: "Apple A16 Bionic", cores: "6", main: "48-12-12 MP", front: "12 MP", battery: "3200 mAh" }),
    variants: [
      { color: "Deep Purple", hex: "#594f63", storageGb: 128, ramGb: 6, price: 119900, stock: 18 },
      { color: "Deep Purple", hex: "#594f63", storageGb: 256, ramGb: 6, price: 129900, stock: 12 },
      { color: "Deep Purple", hex: "#594f63", storageGb: 512, ramGb: 6, price: 149900, stock: 6 },
      { color: "Deep Purple", hex: "#594f63", storageGb: 1024, ramGb: 6, price: 169900, stock: 3 },
      { color: "Space Black", hex: "#3b3b3d", storageGb: 128, ramGb: 6, price: 119900, stock: 20 },
      { color: "Space Black", hex: "#3b3b3d", storageGb: 256, ramGb: 6, price: 129900, stock: 9 },
      { color: "Gold", hex: "#f4e8ce", storageGb: 128, ramGb: 6, price: 119900, stock: 7 },
      { color: "Gold", hex: "#f4e8ce", storageGb: 256, ramGb: 6, price: 129900, stock: 0 },
      { color: "Silver", hex: "#f0f0ee", storageGb: 128, ramGb: 6, price: 119900, stock: 11 },
    ],
  },
  {
    slug: "iphone-15",
    name: "Apple iPhone 15",
    brand: "apple",
    category: "phones",
    kind: "phone",
    daysAgo: 6,
    sales: 610,
    summary: "Dynamic Island, a 48MP Main camera and USB-C, in a colour-infused glass and aluminium design.",
    description: "iPhone 15 brings the Dynamic Island, a 48MP Main camera with 2x Telephoto and USB-C to an aerospace-grade aluminium design with colour-infused back glass.",
    specs: phoneSpecs({ screen: "6.1\"", resolution: "2556 x 1179", refresh: "60 Hz", ppi: "460 ppi", panel: "Super Retina XDR OLED", cpu: "Apple A16 Bionic", cores: "6", gpu: "Apple 5-core", ram: "6 GB", storage: "128GB / 256GB", main: "48-12 MP", front: "12 MP", battery: "3349 mAh", charging: "20W wired, 15W MagSafe", network: "5G", extras: "iPhone, USB-C charge cable" }),
    highlights: phoneHighlights({ screen: "6.1\"", cpu: "Apple A16 Bionic", cores: "6", main: "48-12 MP", front: "12 MP", battery: "3349 mAh" }),
    variants: [
      { color: "Blue", hex: "#d4e4ea", storageGb: 128, ramGb: 6, price: 69900, mrp: 79900, stock: 25 },
      { color: "Blue", hex: "#d4e4ea", storageGb: 256, ramGb: 6, price: 79900, mrp: 89900, stock: 14 },
      { color: "Pink", hex: "#f4d7d6", storageGb: 128, ramGb: 6, price: 69900, mrp: 79900, stock: 17 },
      { color: "Black", hex: "#3a3c3e", storageGb: 128, ramGb: 6, price: 69900, mrp: 79900, stock: 30 },
    ],
  },
  {
    slug: "samsung-galaxy-s24-ultra",
    name: "Samsung Galaxy S24 Ultra",
    brand: "samsung",
    category: "phones",
    kind: "android",
    featured: true,
    daysAgo: 12,
    sales: 720,
    summary: "A titanium frame, built-in S Pen, 200MP camera and Galaxy AI — the most capable Galaxy yet.",
    description: "Galaxy S24 Ultra pairs a 6.8\" QHD+ display with Snapdragon 8 Gen 3 for Galaxy, a 200MP wide camera with 5x optical zoom and Galaxy AI features like Live Translate and Circle to Search.",
    specs: phoneSpecs({ screen: "6.8\"", resolution: "3120 x 1440", refresh: "120 Hz", ppi: "505 ppi", panel: "Dynamic AMOLED 2X", cpu: "Snapdragon 8 Gen 3", cores: "8", gpu: "Adreno 750", ram: "12 GB", storage: "256GB / 512GB", main: "200-50-12-10 MP", front: "12 MP", battery: "5000 mAh", charging: "45W wired, 15W wireless", network: "5G", extras: "Phone, S Pen, USB-C cable, ejection pin" }),
    highlights: phoneHighlights({ screen: "6.8\"", cpu: "Snapdragon 8 Gen 3", cores: "8", main: "200-50-12-10 MP", front: "12 MP", battery: "5000 mAh" }),
    variants: [
      { color: "Titanium Gray", hex: "#8c8c88", storageGb: 256, ramGb: 12, price: 129999, stock: 15 },
      { color: "Titanium Gray", hex: "#8c8c88", storageGb: 512, ramGb: 12, price: 139999, stock: 8 },
      { color: "Titanium Black", hex: "#2e2e2e", storageGb: 256, ramGb: 12, price: 129999, stock: 22 },
      { color: "Titanium Violet", hex: "#5c5470", storageGb: 256, ramGb: 12, price: 129999, stock: 4 },
    ],
  },
  {
    slug: "samsung-galaxy-z-fold-5",
    name: "Samsung Galaxy Z Fold5",
    brand: "samsung",
    category: "phones",
    kind: "foldable",
    daysAgo: 70,
    sales: 210,
    summary: "A phone that unfolds into a 7.6\" tablet, with a gapless Flex Hinge and multitasking built for work.",
    description: "Galaxy Z Fold5 folds flat with the new Flex Hinge, opens to a 7.6\" Main Screen for split-screen multitasking and packs Snapdragon 8 Gen 2 for Galaxy.",
    specs: phoneSpecs({ screen: "7.6\"", resolution: "2176 x 1812", refresh: "120 Hz", ppi: "374 ppi", panel: "Dynamic AMOLED 2X", cpu: "Snapdragon 8 Gen 2", cores: "8", gpu: "Adreno 740", ram: "12 GB", storage: "256GB / 512GB", main: "50-12-10 MP", front: "10 MP", battery: "4400 mAh", charging: "25W wired", network: "5G", extras: "Phone, USB-C cable" }),
    highlights: phoneHighlights({ screen: "7.6\"", cpu: "Snapdragon 8 Gen 2", cores: "8", main: "50-12-10 MP", front: "10 MP", battery: "4400 mAh" }),
    variants: [
      { color: "Icy Blue", hex: "#c9d8e4", storageGb: 256, ramGb: 12, price: 154999, mrp: 164999, stock: 6 },
      { color: "Phantom Black", hex: "#27282a", storageGb: 512, ramGb: 12, price: 164999, mrp: 176999, stock: 5 },
    ],
  },
  {
    slug: "google-pixel-8-pro",
    name: "Google Pixel 8 Pro",
    brand: "google",
    category: "phones",
    kind: "android",
    daysAgo: 55,
    sales: 330,
    summary: "Google Tensor G3, a pro triple camera with Magic Editor and seven years of OS updates.",
    description: "Pixel 8 Pro is engineered by Google with Tensor G3, a 6.7\" Super Actua display, a 50MP triple camera with Video Boost and seven years of security and OS updates.",
    specs: phoneSpecs({ screen: "6.7\"", resolution: "2992 x 1344", refresh: "120 Hz", ppi: "489 ppi", panel: "LTPO OLED", cpu: "Google Tensor G3", cores: "9", gpu: "Mali-G715", ram: "12 GB", storage: "128GB / 256GB", main: "50-48-48 MP", front: "10.5 MP", battery: "5050 mAh", charging: "30W wired, 23W wireless", network: "5G", extras: "Phone, USB-C cable, Quick Switch adapter" }),
    highlights: phoneHighlights({ screen: "6.7\"", cpu: "Google Tensor G3", cores: "9", main: "50-48-48 MP", front: "10.5 MP", battery: "5050 mAh" }),
    variants: [
      { color: "Obsidian", hex: "#2b2b2d", storageGb: 128, ramGb: 12, price: 89999, mrp: 106999, stock: 13 },
      { color: "Bay", hex: "#a9c5de", storageGb: 256, ramGb: 12, price: 96999, mrp: 113999, stock: 7 },
    ],
  },
  {
    slug: "oneplus-12",
    name: "OnePlus 12",
    brand: "oneplus",
    category: "phones",
    kind: "android",
    daysAgo: 20,
    sales: 450,
    summary: "Snapdragon 8 Gen 3, a 4th-gen Hasselblad camera and 80W SUPERVOOC charging.",
    description: "OnePlus 12 combines Snapdragon 8 Gen 3 with up to 16GB RAM, a 2K ProXDR display, the 4th Gen Hasselblad Camera for Mobile and 80W SUPERVOOC charging.",
    specs: phoneSpecs({ screen: "6.82\"", resolution: "3168 x 1440", refresh: "120 Hz", ppi: "510 ppi", panel: "LTPO AMOLED", cpu: "Snapdragon 8 Gen 3", cores: "8", gpu: "Adreno 750", ram: "12 GB / 16 GB", storage: "256GB / 512GB", main: "50-64-48 MP", front: "32 MP", battery: "5400 mAh", charging: "80W wired, 50W wireless", network: "5G", extras: "Phone, 80W charger, USB-C cable, case" }),
    highlights: phoneHighlights({ screen: "6.82\"", cpu: "Snapdragon 8 Gen 3", cores: "8", main: "50-64-48 MP", front: "32 MP", battery: "5400 mAh" }),
    variants: [
      { color: "Flowy Emerald", hex: "#2f5d50", storageGb: 256, ramGb: 12, price: 64999, stock: 19 },
      { color: "Flowy Emerald", hex: "#2f5d50", storageGb: 512, ramGb: 16, price: 69999, stock: 9 },
      { color: "Silky Black", hex: "#1f1f1f", storageGb: 256, ramGb: 12, price: 64999, stock: 23 },
    ],
  },
  {
    slug: "xiaomi-14",
    name: "Xiaomi 14",
    brand: "xiaomi",
    category: "phones",
    kind: "android",
    daysAgo: 30,
    sales: 160,
    summary: "Leica Summilux optics and Snapdragon 8 Gen 3 in a compact 6.36\" design.",
    description: "Xiaomi 14 brings Leica Summilux optical lenses, Snapdragon 8 Gen 3 and a 6.36\" 120Hz CrystalRes AMOLED display to a compact flagship.",
    specs: phoneSpecs({ screen: "6.36\"", resolution: "2670 x 1200", refresh: "120 Hz", ppi: "460 ppi", panel: "LTPO AMOLED", cpu: "Snapdragon 8 Gen 3", cores: "8", gpu: "Adreno 750", ram: "12 GB", storage: "512GB", main: "50-50-50 MP", front: "32 MP", battery: "4610 mAh", charging: "90W wired, 50W wireless", network: "5G", extras: "Phone, 90W charger, USB-C cable, case" }),
    highlights: phoneHighlights({ screen: "6.36\"", cpu: "Snapdragon 8 Gen 3", cores: "8", main: "50-50-50 MP", front: "32 MP", battery: "4610 mAh" }),
    variants: [
      { color: "Jade Green", hex: "#9fb9a3", storageGb: 512, ramGb: 12, price: 69999, mrp: 79999, stock: 10 },
      { color: "Black", hex: "#222222", storageGb: 512, ramGb: 12, price: 69999, mrp: 79999, stock: 12 },
    ],
  },
  // ============================== Computers
  {
    slug: "macbook-air-15",
    name: "Apple MacBook Air 15\" M3",
    brand: "apple",
    category: "computers",
    kind: "laptop",
    featured: true,
    daysAgo: 15,
    sales: 520,
    summary: "The 15-inch MacBook Air makes room for more of what you love with a spacious Liquid Retina display and the M3 chip.",
    description: "Strikingly thin and fast, MacBook Air 15\" with M3 brings up to 18 hours of battery, a 15.3\" Liquid Retina display, a 1080p camera and a six-speaker sound system — in a fanless, silent design.",
    specs: laptopSpecs({ screen: "15.3\"", resolution: "2880 x 1864", panel: "Liquid Retina IPS", cpu: "Apple M3", cores: "8", gpu: "10-core GPU", ram: "8 GB / 16 GB", storage: "256GB / 512GB", battery: "Up to 18 hours", weight: "1.51 kg", ports: "2x Thunderbolt / USB 4, MagSafe 3, 3.5 mm" }),
    highlights: laptopHighlights({ screen: "15.3\"", cpu: "Apple M3", cores: "8", storage: "256GB SSD", battery: "Up to 18 hours", weight: "1.51 kg" }),
    variants: [
      { color: "Midnight", hex: "#2e3642", storageGb: 256, ramGb: 8, price: 134900, stock: 10 },
      { color: "Midnight", hex: "#2e3642", storageGb: 512, ramGb: 16, price: 174900, stock: 5 },
      { color: "Starlight", hex: "#e3dcd1", storageGb: 256, ramGb: 8, price: 134900, stock: 8 },
      { color: "Silver", hex: "#e3e4e5", storageGb: 256, ramGb: 8, price: 134900, stock: 9 },
      { color: "Space Gray", hex: "#7d7e80", storageGb: 512, ramGb: 16, price: 174900, stock: 4 },
    ],
  },
  {
    slug: "macbook-pro-14",
    name: "Apple MacBook Pro 14\" M3 Pro",
    brand: "apple",
    category: "computers",
    kind: "laptop",
    daysAgo: 45,
    sales: 290,
    summary: "M3 Pro power, up to 18 hours of battery and the best display ever in a laptop.",
    description: "MacBook Pro 14\" with M3 Pro delivers pro performance with an 11-core CPU and 14-core GPU, a Liquid Retina XDR display with 1600 nits peak HDR brightness and a full set of pro ports.",
    specs: laptopSpecs({ screen: "14.2\"", resolution: "3024 x 1964", panel: "Liquid Retina XDR mini-LED", cpu: "Apple M3 Pro", cores: "11", gpu: "14-core GPU", ram: "18 GB", storage: "512GB / 1TB", battery: "Up to 18 hours", weight: "1.61 kg", ports: "3x Thunderbolt 4, HDMI, SDXC, MagSafe 3" }),
    highlights: laptopHighlights({ screen: "14.2\"", cpu: "Apple M3 Pro", cores: "11", storage: "512GB SSD", battery: "Up to 18 hours", weight: "1.61 kg" }),
    variants: [
      { color: "Space Black", hex: "#2b2b2d", storageGb: 512, ramGb: 18, price: 199900, stock: 7 },
      { color: "Space Black", hex: "#2b2b2d", storageGb: 1024, ramGb: 18, price: 239900, stock: 3 },
      { color: "Silver", hex: "#e3e4e5", storageGb: 512, ramGb: 18, price: 199900, stock: 6 },
    ],
  },
  {
    slug: "dell-xps-13",
    name: "Dell XPS 13 (Intel Core Ultra 7)",
    brand: "dell",
    category: "computers",
    kind: "laptop",
    daysAgo: 80,
    sales: 120,
    summary: "An edge-to-edge 13.4\" InfinityEdge display, Intel Core Ultra 7 and a machined aluminium body.",
    description: "Dell XPS 13 packs Intel Core Ultra 7 with Intel AI Boost, a 13.4\" InfinityEdge display and a seamless glass touchpad into a 1.19 kg CNC-machined aluminium chassis.",
    specs: laptopSpecs({ screen: "13.4\"", resolution: "1920 x 1200", panel: "IPS, 500 nits", cpu: "Intel Core Ultra 7 155H", cores: "16", gpu: "Intel Arc", ram: "16 GB / 32 GB", storage: "512GB / 1TB", battery: "Up to 13 hours", weight: "1.19 kg", ports: "2x Thunderbolt 4" }),
    highlights: laptopHighlights({ screen: "13.4\"", cpu: "Intel Core Ultra 7", cores: "16", storage: "512GB SSD", battery: "Up to 13 hours", weight: "1.19 kg" }),
    variants: [
      { color: "Platinum", hex: "#d9d9d9", storageGb: 512, ramGb: 16, price: 139990, mrp: 179990, stock: 6 },
      { color: "Graphite", hex: "#4a4a4a", storageGb: 1024, ramGb: 32, price: 169990, mrp: 209990, stock: 3 },
    ],
  },
  {
    slug: "lenovo-legion-pro-5",
    name: "Lenovo Legion Pro 5 (RTX 4070)",
    brand: "lenovo",
    category: "computers",
    kind: "laptop",
    daysAgo: 25,
    sales: 140,
    summary: "A 16\" 240Hz WQXGA display, Intel Core i9 and GeForce RTX 4070 tuned by Legion AI Engine+.",
    description: "Legion Pro 5 is built for esports with a 16\" WQXGA 240Hz display, Intel Core i9-14900HX, NVIDIA GeForce RTX 4070 and Legion Coldfront 5.0 cooling.",
    specs: laptopSpecs({ screen: "16\"", resolution: "2560 x 1600", panel: "IPS, 240 Hz", cpu: "Intel Core i9-14900HX", cores: "24", gpu: "NVIDIA GeForce RTX 4070", ram: "16 GB / 32 GB", storage: "1TB", battery: "Up to 6 hours", weight: "2.5 kg", ports: "4x USB, HDMI 2.1, RJ45, USB-C" }),
    highlights: laptopHighlights({ screen: "16\"", cpu: "Intel Core i9-14900HX", cores: "24", storage: "1TB SSD", battery: "Up to 6 hours", weight: "2.5 kg" }),
    variants: [
      { color: "Onyx Grey", hex: "#3d3f45", storageGb: 1024, ramGb: 16, price: 189990, stock: 5 },
      { color: "Onyx Grey", hex: "#3d3f45", storageGb: 1024, ramGb: 32, price: 214990, stock: 2 },
    ],
  },
  {
    slug: "imac-24",
    name: "Apple iMac 24\" M3",
    brand: "apple",
    category: "computers",
    kind: "desktop",
    daysAgo: 60,
    sales: 95,
    summary: "A strikingly thin all-in-one with a 4.5K Retina display and the M3 chip, in seven vibrant colours.",
    description: "iMac 24\" with M3 features a 4.5K Retina display, a 1080p FaceTime HD camera, studio-quality mics and a six-speaker sound system in an 11.5 mm thin design.",
    specs: laptopSpecs({ screen: "24\"", resolution: "4480 x 2520", panel: "4.5K Retina IPS", cpu: "Apple M3", cores: "8", gpu: "8-core GPU", ram: "8 GB", storage: "256GB / 512GB", battery: "Mains powered", weight: "4.43 kg", ports: "2x Thunderbolt / USB 4" }),
    highlights: laptopHighlights({ screen: "24\"", cpu: "Apple M3", cores: "8", storage: "256GB SSD", battery: "Mains powered", weight: "4.43 kg" }),
    variants: [
      { color: "Blue", hex: "#5c8bc4", storageGb: 256, ramGb: 8, price: 134900, stock: 4 },
      { color: "Green", hex: "#8db89a", storageGb: 256, ramGb: 8, price: 134900, stock: 3 },
      { color: "Pink", hex: "#e7a1a4", storageGb: 512, ramGb: 8, price: 154900, stock: 2 },
    ],
  },
  {
    slug: "ipad-pro-13",
    name: "Apple iPad Pro 13\" M4",
    brand: "apple",
    category: "computers",
    kind: "tablet",
    featured: true,
    daysAgo: 4,
    sales: 260,
    summary: "The thinnest Apple product ever, with an Ultra Retina XDR tandem-OLED display and the M4 chip.",
    description: "iPad Pro 13\" with M4 combines a breakthrough Ultra Retina XDR display, pro cameras with ProRes and support for Apple Pencil Pro — in a 5.1 mm thin aluminium design.",
    specs: laptopSpecs({ screen: "13\"", resolution: "2752 x 2064", panel: "Ultra Retina XDR tandem OLED", cpu: "Apple M4", cores: "9", gpu: "10-core GPU", ram: "8 GB / 16 GB", storage: "256GB / 512GB / 1TB", battery: "Up to 10 hours", weight: "579 g", ports: "Thunderbolt / USB 4" }),
    highlights: laptopHighlights({ screen: "13\"", cpu: "Apple M4", cores: "9", storage: "256GB", battery: "Up to 10 hours", weight: "579 g" }),
    variants: [
      { color: "Space Black", hex: "#2b2b2d", storageGb: 256, ramGb: 8, price: 129900, stock: 9 },
      { color: "Space Black", hex: "#2b2b2d", storageGb: 512, ramGb: 8, price: 149900, stock: 5 },
      { color: "Space Black", hex: "#2b2b2d", storageGb: 1024, ramGb: 16, price: 189900, stock: 2 },
      { color: "Silver", hex: "#e3e4e5", storageGb: 256, ramGb: 8, price: 129900, stock: 7 },
    ],
  },
  // ============================== Smart watches
  {
    slug: "apple-watch-ultra-2",
    name: "Apple Watch Ultra 2",
    brand: "apple",
    category: "smart-watches",
    kind: "watch",
    featured: true,
    daysAgo: 35,
    sales: 300,
    summary: "The most rugged and capable Apple Watch, with a 3000-nit display, precision dual-frequency GPS and up to 36 hours of battery.",
    description: "Apple Watch Ultra 2 has a 49 mm titanium case, the brightest Apple display ever, the S9 SiP with double tap, precision dual-frequency GPS and an 86 dB emergency siren.",
    specs: watchSpecs({ caseSize: "49 mm", display: "Always-On Retina LTPO2 OLED, 3000 nits", chip: "Apple S9 SiP", battery: "Up to 36 hours", water: "WR100, EN13319 dive", sensors: "ECG, blood oxygen, temperature, depth", box: "Watch, band, magnetic fast charger" }),
    highlights: [
      { icon: "display", label: "Case size", value: "49 mm" },
      { icon: "cpu", label: "Chip", value: "Apple S9 SiP" },
      { icon: "battery", label: "Battery life", value: "Up to 36 h" },
      { icon: "weight", label: "Weight", value: "61.4 g" },
    ],
    variants: [
      { color: "Orange Alpine Loop", hex: "#f26b1d", price: 89900, stock: 8 },
      { color: "Blue Ocean Band", hex: "#3e5c8a", price: 89900, stock: 6 },
      { color: "Olive Trail Loop", hex: "#6b7a4f", price: 89900, stock: 0 },
    ],
  },
  {
    slug: "apple-watch-series-9",
    name: "Apple Watch Series 9",
    brand: "apple",
    category: "smart-watches",
    kind: "watch",
    daysAgo: 50,
    sales: 410,
    summary: "A brighter display, magical double tap and the S9 chip — a powerful health and fitness companion.",
    description: "Apple Watch Series 9 features the S9 SiP, a display up to 2000 nits, double tap gesture, on-device Siri and advanced health features including ECG and blood oxygen.",
    specs: watchSpecs({ caseSize: "45 mm", display: "Always-On Retina LTPO OLED, 2000 nits", chip: "Apple S9 SiP", battery: "Up to 18 hours", water: "WR50", sensors: "ECG, blood oxygen, temperature", box: "Watch, sport band, magnetic fast charger" }),
    highlights: [
      { icon: "display", label: "Case size", value: "45 mm" },
      { icon: "cpu", label: "Chip", value: "Apple S9 SiP" },
      { icon: "battery", label: "Battery life", value: "Up to 18 h" },
      { icon: "weight", label: "Weight", value: "38.7 g" },
    ],
    variants: [
      { color: "Midnight", hex: "#2e3642", price: 41900, mrp: 44900, stock: 14 },
      { color: "Starlight", hex: "#e3dcd1", price: 41900, mrp: 44900, stock: 12 },
      { color: "(PRODUCT)RED", hex: "#b5272d", price: 41900, mrp: 44900, stock: 5 },
    ],
  },
  {
    slug: "samsung-galaxy-watch-6",
    name: "Samsung Galaxy Watch6 Classic",
    brand: "samsung",
    category: "smart-watches",
    kind: "watch",
    daysAgo: 90,
    sales: 180,
    summary: "The iconic rotating bezel returns, with advanced sleep coaching and a larger Super AMOLED display.",
    description: "Galaxy Watch6 Classic brings back the rotating bezel with a 47 mm stainless steel case, personalised heart-rate zones, sleep coaching and body composition analysis.",
    specs: watchSpecs({ caseSize: "47 mm", display: "Super AMOLED, sapphire crystal", chip: "Exynos W930", battery: "Up to 40 hours", water: "5ATM + IP68", sensors: "ECG, BIA, blood pressure", box: "Watch, band, wireless charger" }),
    highlights: [
      { icon: "display", label: "Case size", value: "47 mm" },
      { icon: "cpu", label: "Chip", value: "Exynos W930" },
      { icon: "battery", label: "Battery life", value: "Up to 40 h" },
      { icon: "weight", label: "Weight", value: "59 g" },
    ],
    variants: [
      { color: "Graphite", hex: "#3a3a3c", price: 16499, mrp: 32999, stock: 11 },
      { color: "Silver", hex: "#d6d6d6", price: 16499, mrp: 32999, stock: 9 },
    ],
  },
  {
    slug: "garmin-fenix-7",
    name: "Garmin fēnix 7 Pro Solar",
    brand: "garmin",
    category: "smart-watches",
    kind: "watch",
    daysAgo: 100,
    sales: 60,
    summary: "A multisport GPS watch with solar charging, a built-in LED flashlight and up to 18 days of battery.",
    description: "fēnix 7 Pro Solar adds solar charging, a built-in flashlight, Elevate Gen 5 heart-rate sensor and topographic maps to Garmin's flagship adventure watch.",
    specs: watchSpecs({ caseSize: "47 mm", display: "Transflective MIP, Power Glass", chip: "Garmin multi-band", battery: "Up to 18 days", water: "10 ATM", sensors: "Heart rate, Pulse Ox, altimeter, compass", box: "Watch, charging cable" }),
    highlights: [
      { icon: "display", label: "Case size", value: "47 mm" },
      { icon: "battery", label: "Battery life", value: "Up to 18 days" },
      { icon: "weight", label: "Weight", value: "73 g" },
    ],
    variants: [{ color: "Slate Gray", hex: "#4b4f54", price: 82990, stock: 4 }],
  },
  // ============================== Cameras
  {
    slug: "sony-alpha-7-iv",
    name: "Sony Alpha 7 IV Mirrorless Camera",
    brand: "sony",
    category: "cameras",
    kind: "camera",
    featured: true,
    daysAgo: 120,
    sales: 85,
    summary: "A 33MP full-frame hybrid with real-time Eye AF, 4K 60p 10-bit video and 5-axis stabilisation.",
    description: "Alpha 7 IV combines a 33MP back-illuminated Exmor R sensor with the BIONZ XR engine, real-time tracking Eye AF for humans, animals and birds, and 4K 60p 10-bit 4:2:2 video.",
    specs: cameraSpecs({ sensor: "Full-frame", resolution: "33 MP", video: "4K 60p 10-bit", iso: "100–51200", af: "759-point hybrid, real-time Eye AF", ibis: "5-axis, 5.5 stops", battery: "Approx. 580 shots", weight: "658 g" }),
    highlights: [
      { icon: "camera", label: "Sensor", value: "33 MP full-frame" },
      { icon: "cpu", label: "Processor", value: "BIONZ XR" },
      { icon: "battery", label: "Battery", value: "580 shots" },
      { icon: "weight", label: "Weight", value: "658 g" },
    ],
    variants: [{ color: "Black", hex: "#1f1f1f", price: 219990, stock: 5 }],
  },
  {
    slug: "canon-eos-r6-ii",
    name: "Canon EOS R6 Mark II",
    brand: "canon",
    category: "cameras",
    kind: "camera",
    daysAgo: 140,
    sales: 70,
    summary: "24MP full-frame speed with 40 fps bursts, 8-stop stabilisation and uncropped 4K 60p.",
    description: "EOS R6 Mark II is a versatile full-frame hybrid with a 24.2MP sensor, up to 40 fps electronic shutter, Dual Pixel CMOS AF II and oversampled 6K-to-4K 60p video.",
    specs: cameraSpecs({ sensor: "Full-frame", resolution: "24 MP", video: "4K 60p 10-bit", iso: "100–102400", af: "Dual Pixel CMOS AF II", ibis: "5-axis, 8 stops", battery: "Approx. 760 shots", weight: "670 g" }),
    highlights: [
      { icon: "camera", label: "Sensor", value: "24 MP full-frame" },
      { icon: "cpu", label: "Processor", value: "DIGIC X" },
      { icon: "battery", label: "Battery", value: "760 shots" },
      { icon: "weight", label: "Weight", value: "670 g" },
    ],
    variants: [{ color: "Black", hex: "#1f1f1f", price: 199995, mrp: 243995, stock: 4 }],
  },
  {
    slug: "fujifilm-x-t5",
    name: "Fujifilm X-T5",
    brand: "fujifilm",
    category: "cameras",
    kind: "camera",
    daysAgo: 95,
    sales: 75,
    summary: "40MP APS-C resolution and classic dials, with 7-stop IBIS and Film Simulation looks.",
    description: "X-T5 puts a 40.2MP X-Trans CMOS 5 HR sensor inside a compact, dial-driven body with 7-stop in-body stabilisation, 6.2K video and Fujifilm's 19 Film Simulation modes.",
    specs: cameraSpecs({ sensor: "APS-C", resolution: "40 MP", video: "6.2K 30p", iso: "125–12800", af: "425-point hybrid, subject detection", ibis: "5-axis, 7 stops", battery: "Approx. 580 shots", weight: "557 g" }),
    highlights: [
      { icon: "camera", label: "Sensor", value: "40 MP APS-C" },
      { icon: "cpu", label: "Processor", value: "X-Processor 5" },
      { icon: "battery", label: "Battery", value: "580 shots" },
      { icon: "weight", label: "Weight", value: "557 g" },
    ],
    variants: [
      { color: "Silver", hex: "#c9c9c9", price: 169999, stock: 3 },
      { color: "Black", hex: "#1f1f1f", price: 169999, stock: 4 },
    ],
  },
  // ============================== Headphones
  {
    slug: "airpods-max",
    name: "Apple AirPods Max",
    brand: "apple",
    category: "headphones",
    kind: "headphones",
    featured: true,
    daysAgo: 160,
    sales: 380,
    summary: "Computational audio with Active Noise Cancellation, Transparency mode and personalised Spatial Audio.",
    description: "AirPods Max reimagines over-ear headphones with an Apple-designed dynamic driver, Active Noise Cancellation, Transparency mode and Spatial Audio with dynamic head tracking.",
    specs: audioSpecs({ type: "Over-ear", anc: "Active Noise Cancellation", battery: "Up to 20 hours", driver: "40 mm dynamic", codecs: "AAC", weight: "384.8 g", box: "Headphones, Smart Case, USB-C cable" }),
    highlights: [
      { icon: "battery", label: "Battery life", value: "Up to 20 h" },
      { icon: "cpu", label: "Chip", value: "Apple H1 (x2)" },
      { icon: "weight", label: "Weight", value: "384.8 g" },
    ],
    variants: [
      { color: "Space Gray", hex: "#5b5c5e", price: 49900, mrp: 59900, stock: 9 },
      { color: "Silver", hex: "#e3e3e3", price: 49900, mrp: 59900, stock: 11 },
      { color: "Sky Blue", hex: "#a8c2d4", price: 49900, mrp: 59900, stock: 6 },
      { color: "Pink", hex: "#f1c9c1", price: 49900, mrp: 59900, stock: 4 },
      { color: "Green", hex: "#a9c2a1", price: 49900, mrp: 59900, stock: 3 },
    ],
  },
  {
    slug: "airpods-pro-2",
    name: "Apple AirPods Pro (2nd gen) USB-C",
    brand: "apple",
    category: "headphones",
    kind: "earbuds",
    featured: true,
    daysAgo: 28,
    sales: 880,
    summary: "Up to 2x more Active Noise Cancellation, Adaptive Audio and a USB-C MagSafe case.",
    description: "AirPods Pro 2 deliver up to 2x more Active Noise Cancellation, Adaptive Audio that blends ANC and Transparency, Conversation Awareness and a MagSafe case with USB-C and a speaker for Find My.",
    specs: audioSpecs({ type: "In-ear", anc: "Adaptive ANC", battery: "Up to 30 hours with case", driver: "Custom high-excursion", codecs: "AAC", weight: "5.3 g per bud", box: "AirPods Pro, MagSafe case, ear tips (XS-L), USB-C cable" }),
    highlights: [
      { icon: "battery", label: "Battery life", value: "Up to 30 h" },
      { icon: "cpu", label: "Chip", value: "Apple H2" },
      { icon: "weight", label: "Weight", value: "5.3 g" },
    ],
    variants: [{ color: "White", hex: "#f5f5f5", price: 24900, stock: 40 }],
  },
  {
    slug: "sony-wh-1000xm5",
    name: "Sony WH-1000XM5",
    brand: "sony",
    category: "headphones",
    kind: "headphones",
    daysAgo: 200,
    sales: 520,
    summary: "Industry-leading noise cancellation with eight microphones and 30 hours of battery.",
    description: "WH-1000XM5 uses two processors and eight microphones for industry-leading noise cancellation, a 30 mm carbon-fibre driver and up to 30 hours of battery with 3-minute quick charge for 3 hours.",
    specs: audioSpecs({ type: "Over-ear", anc: "Industry-leading ANC (8 mics)", battery: "Up to 30 hours", driver: "30 mm carbon fibre", codecs: "LDAC, AAC, SBC", weight: "250 g", box: "Headphones, case, USB-C cable, audio cable" }),
    highlights: [
      { icon: "battery", label: "Battery life", value: "Up to 30 h" },
      { icon: "cpu", label: "Processor", value: "QN1 + V1" },
      { icon: "weight", label: "Weight", value: "250 g" },
    ],
    variants: [
      { color: "Black", hex: "#222222", price: 26990, mrp: 34990, stock: 18 },
      { color: "Silver", hex: "#d8d4cc", price: 26990, mrp: 34990, stock: 10 },
    ],
  },
  {
    slug: "bose-quietcomfort-ultra",
    name: "Bose QuietComfort Ultra Headphones",
    brand: "bose",
    category: "headphones",
    kind: "headphones",
    daysAgo: 75,
    sales: 150,
    summary: "World-class noise cancellation and Bose Immersive Audio for a spatial listening experience.",
    description: "QuietComfort Ultra Headphones combine Bose's best noise cancellation with Immersive Audio, CustomTune calibration and a premium, foldable design with up to 24 hours of battery.",
    specs: audioSpecs({ type: "Over-ear", anc: "CustomTune ANC", battery: "Up to 24 hours", driver: "35 mm", codecs: "aptX Adaptive, AAC, SBC", weight: "254 g", box: "Headphones, case, USB-C cable, audio cable" }),
    highlights: [
      { icon: "battery", label: "Battery life", value: "Up to 24 h" },
      { icon: "weight", label: "Weight", value: "254 g" },
    ],
    variants: [
      { color: "Black", hex: "#222222", price: 35900, stock: 7 },
      { color: "White Smoke", hex: "#e8e5df", price: 35900, stock: 5 },
    ],
  },
  {
    slug: "samsung-galaxy-buds-2-pro",
    name: "Samsung Galaxy Buds2 Pro",
    brand: "samsung",
    category: "headphones",
    kind: "earbuds",
    daysAgo: 220,
    sales: 340,
    summary: "24-bit Hi-Fi sound, intelligent ANC and an ergonomic fit that's 15% smaller.",
    description: "Galaxy Buds2 Pro deliver 24-bit Hi-Fi audio, Intelligent ANC with three high-SNR microphones, 360 Audio with direct multi-channel and IPX7 water resistance.",
    specs: audioSpecs({ type: "In-ear", anc: "Intelligent ANC", battery: "Up to 29 hours with case", driver: "2-way coaxial", codecs: "Samsung Seamless, AAC, SBC", weight: "5.5 g per bud", box: "Earbuds, case, ear tips, USB-C cable" }),
    highlights: [
      { icon: "battery", label: "Battery life", value: "Up to 29 h" },
      { icon: "weight", label: "Weight", value: "5.5 g" },
    ],
    variants: [
      { color: "Graphite", hex: "#3a3a3c", price: 11999, mrp: 17999, stock: 25 },
      { color: "Bora Purple", hex: "#b6a6d8", price: 11999, mrp: 17999, stock: 14 },
    ],
  },
  // ============================== Gaming
  {
    slug: "playstation-5",
    name: "Sony PlayStation 5 Slim (Disc Edition)",
    brand: "sony",
    category: "gaming",
    kind: "console",
    featured: true,
    daysAgo: 65,
    sales: 760,
    summary: "Lightning-fast loading with an ultra-high-speed SSD, haptic feedback and adaptive triggers.",
    description: "Incredibly powerful CPUs, GPUs, and an SSD with integrated I/O will redefine your PlayStation experience. The slimmer PS5 keeps 4K gaming at up to 120 fps, ray tracing and the DualSense wireless controller.",
    specs: gamingSpecs({ platform: "PlayStation", cpu: "8-core AMD Zen 2, 3.5 GHz", gpu: "10.3 TFLOPS AMD RDNA 2", storage: "1TB SSD", output: "HDMI 2.1, 4K 120Hz, 8K", box: "Console, DualSense controller, HDMI cable, AC cord, USB cable" }),
    highlights: [
      { icon: "cpu", label: "CPU", value: "AMD Zen 2" },
      { icon: "cores", label: "Number of Cores", value: "8" },
      { icon: "storage", label: "Storage", value: "1TB SSD" },
      { icon: "display", label: "Output", value: "4K 120 Hz" },
    ],
    variants: [{ color: "White", hex: "#f2f2f2", storageGb: 1024, price: 54990, stock: 16 }],
  },
  {
    slug: "xbox-series-x",
    name: "Microsoft Xbox Series X",
    brand: "microsoft",
    category: "gaming",
    kind: "tower",
    daysAgo: 150,
    sales: 230,
    summary: "The fastest, most powerful Xbox ever, with 12 teraflops and Quick Resume.",
    description: "Xbox Series X delivers 12 teraflops of raw graphic processing power, true 4K gaming at up to 120 fps, a custom 1TB SSD and Quick Resume across multiple games.",
    specs: gamingSpecs({ platform: "Xbox", cpu: "8-core AMD Zen 2, 3.8 GHz", gpu: "12 TFLOPS AMD RDNA 2", storage: "1TB SSD", output: "HDMI 2.1, 4K 120Hz", box: "Console, wireless controller, HDMI cable, power cable" }),
    highlights: [
      { icon: "cpu", label: "CPU", value: "AMD Zen 2" },
      { icon: "cores", label: "Number of Cores", value: "8" },
      { icon: "storage", label: "Storage", value: "1TB SSD" },
      { icon: "display", label: "Output", value: "4K 120 Hz" },
    ],
    variants: [{ color: "Carbon Black", hex: "#1c1c1c", storageGb: 1024, price: 49990, mrp: 55990, stock: 9 }],
  },
  {
    slug: "dualsense-controller",
    name: "Sony DualSense Wireless Controller",
    brand: "sony",
    category: "gaming",
    kind: "controller",
    daysAgo: 10,
    sales: 690,
    summary: "Haptic feedback, adaptive triggers and a built-in microphone for PS5.",
    description: "The DualSense controller brings immersive haptic feedback, dynamic adaptive triggers, a built-in microphone and an integrated 3.5 mm audio jack to PlayStation 5.",
    specs: gamingSpecs({ platform: "PlayStation", cpu: "—", gpu: "—", storage: "—", output: "Bluetooth / USB-C", box: "Controller, USB-C cable" }),
    highlights: [
      { icon: "battery", label: "Battery life", value: "Up to 12 h" },
      { icon: "weight", label: "Weight", value: "280 g" },
    ],
    variants: [
      { color: "White", hex: "#f2f2f2", price: 5990, mrp: 6390, stock: 50 },
      { color: "Midnight Black", hex: "#222222", price: 5990, mrp: 6390, stock: 35 },
      { color: "Cosmic Red", hex: "#b0273a", price: 6490, mrp: 6890, stock: 20 },
    ],
  },
  {
    slug: "apple-vision-pro",
    name: "Apple Vision Pro",
    brand: "apple",
    category: "gaming",
    kind: "vr",
    featured: true,
    daysAgo: 8,
    sales: 45,
    summary: "An immersive way to experience entertainment, with micro-OLED displays and visionOS.",
    description: "Apple Vision Pro seamlessly blends digital content with your physical space using two micro-OLED displays with 23 million pixels, the M2 and R1 chips and an intuitive input system of eyes, hands and voice.",
    specs: gamingSpecs({ platform: "visionOS", cpu: "Apple M2 + R1", gpu: "10-core GPU", storage: "256GB / 512GB / 1TB", output: "Micro-OLED, 23M pixels", box: "Vision Pro, Solo Knit Band, Dual Loop Band, light seal, battery, cover" }),
    highlights: [
      { icon: "cpu", label: "Chip", value: "Apple M2 + R1" },
      { icon: "display", label: "Displays", value: "23M pixels" },
      { icon: "storage", label: "Storage", value: "256GB" },
      { icon: "battery", label: "Battery", value: "Up to 2 h" },
    ],
    variants: [
      { color: "Silver", hex: "#d9d9d9", storageGb: 256, price: 349900, stock: 3 },
      { color: "Silver", hex: "#d9d9d9", storageGb: 512, price: 369900, stock: 2 },
    ],
  },
  {
    slug: "meta-quest-3",
    name: "Meta Quest 3",
    brand: "meta",
    category: "gaming",
    kind: "vr",
    daysAgo: 110,
    sales: 190,
    summary: "Breakthrough mixed reality with full-colour passthrough and Snapdragon XR2 Gen 2.",
    description: "Meta Quest 3 blends virtual and physical worlds with full-colour mixed reality, 4K+ Infinite Display resolution and the Snapdragon XR2 Gen 2 platform — no PC required.",
    specs: gamingSpecs({ platform: "Meta Horizon OS", cpu: "Snapdragon XR2 Gen 2", gpu: "Adreno 740", storage: "128GB / 512GB", output: "2064 x 2208 per eye", box: "Headset, Touch Plus controllers, charging cable, power adapter" }),
    highlights: [
      { icon: "cpu", label: "Chip", value: "Snapdragon XR2 Gen 2" },
      { icon: "display", label: "Resolution", value: "2064 x 2208 / eye" },
      { icon: "storage", label: "Storage", value: "128GB" },
      { icon: "battery", label: "Battery", value: "Up to 2.2 h" },
    ],
    variants: [
      { color: "White", hex: "#ededed", storageGb: 128, price: 49999, mrp: 54999, stock: 12 },
      { color: "White", hex: "#ededed", storageGb: 512, price: 64999, mrp: 74999, stock: 6 },
    ],
  },
];

export function colorSlug(color: string): string {
  return color.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

export function artPath(kind: ArtKind, color: string, view: "main" | "alt" = "main"): string {
  return `/images/products/${kind}-${colorSlug(color)}${view === "alt" ? "-alt" : ""}.svg`;
}
