/**
 * Demo catalogue for development and demos. Prices, costs, stock, lead times and export
 * classifications are ILLUSTRATIVE ONLY: procurement replaces them with the OEM / distributor price
 * lists (FR-NS-06) and Trade Compliance confirms every classification.
 */
export interface SeedProduct {
  sku: string;
  name: string;
  category: 'gpu_server' | 'rack_system' | 'networking' | 'optics' | 'storage' | 'software' | 'service' | 'support' | 'rack_infra';
  oem?: string;
  gpu_model?: string;
  gpus_per_unit?: number;
  power_kw?: number;
  rack_units?: number;
  cooling?: 'air' | 'liquid';
  unit?: string;
  list_price: number;
  cost: number;
  stock: number;
  lead_time_weeks: number;
  export_class: string;
  attrs?: Record<string, unknown>;
}

export const DEMO_CATALOG: SeedProduct[] = [
  { sku: 'SMC-HGX-H200-8G', name: 'Supermicro HGX H200 8-GPU server (SYS-821GE)', category: 'gpu_server', oem: 'Supermicro', gpu_model: 'H200', gpus_per_unit: 8, power_kw: 10.2, rack_units: 8, list_price: 298000, cost: 271000, stock: 10, lead_time_weeks: 4, export_class: '4A090' },
  { sku: 'DELL-XE9680-H200', name: 'Dell PowerEdge XE9680, 8x H200', category: 'gpu_server', oem: 'Dell', gpu_model: 'H200', gpus_per_unit: 8, power_kw: 10.2, rack_units: 6, list_price: 315000, cost: 287000, stock: 6, lead_time_weeks: 6, export_class: '4A090' },
  { sku: 'SMC-HGX-H100-8G', name: 'Supermicro HGX H100 8-GPU server', category: 'gpu_server', oem: 'Supermicro', gpu_model: 'H100', gpus_per_unit: 8, power_kw: 10.2, rack_units: 8, list_price: 245000, cost: 222000, stock: 4, lead_time_weeks: 6, export_class: '4A090' },
  { sku: 'SMC-HGX-B200-8G', name: 'Supermicro HGX B200 8-GPU server (air)', category: 'gpu_server', oem: 'Supermicro', gpu_model: 'B200', gpus_per_unit: 8, power_kw: 14.3, rack_units: 10, list_price: 420000, cost: 383000, stock: 2, lead_time_weeks: 10, export_class: '4A090' },
  { sku: 'DELL-XE9680L-B200', name: 'Dell PowerEdge XE9680L, 8x B200 (direct liquid cooled)', category: 'gpu_server', oem: 'Dell', gpu_model: 'B200', gpus_per_unit: 8, power_kw: 14.3, rack_units: 4, cooling: 'liquid', list_price: 435000, cost: 396000, stock: 0, lead_time_weeks: 14, export_class: '4A090' },
  { sku: 'HPE-XD685-B200', name: 'HPE Cray XD685, 8x B200', category: 'gpu_server', oem: 'HPE', gpu_model: 'B200', gpus_per_unit: 8, power_kw: 14.3, rack_units: 6, cooling: 'liquid', list_price: 440000, cost: 401000, stock: 1, lead_time_weeks: 12, export_class: '4A090' },
  { sku: 'SMC-MI325X-8G', name: 'Supermicro AS-8125GS, 8x AMD Instinct MI325X', category: 'gpu_server', oem: 'Supermicro', gpu_model: 'MI325X', gpus_per_unit: 8, power_kw: 11, rack_units: 8, list_price: 280000, cost: 254000, stock: 3, lead_time_weeks: 8, export_class: '4A090' },
  { sku: 'DELL-R760XA-L40S', name: 'Dell PowerEdge R760xa, 4x L40S', category: 'gpu_server', oem: 'Dell', gpu_model: 'L40S', gpus_per_unit: 4, power_kw: 2.4, rack_units: 2, list_price: 72000, cost: 63500, stock: 20, lead_time_weeks: 2, export_class: '5A992' },
  { sku: 'NV-GB200-NVL72', name: 'NVIDIA GB200 NVL72 rack-scale system', category: 'rack_system', oem: 'Supermicro', gpu_model: 'GB200 NVL72', gpus_per_unit: 72, power_kw: 132, rack_units: 48, cooling: 'liquid', list_price: 3400000, cost: 3155000, stock: 0, lead_time_weeks: 20, export_class: '4A090' },
  { sku: 'NV-GB300-NVL72', name: 'NVIDIA GB300 NVL72 rack-scale system', category: 'rack_system', oem: 'Supermicro', gpu_model: 'GB300 NVL72', gpus_per_unit: 72, power_kw: 140, rack_units: 48, cooling: 'liquid', list_price: 3900000, cost: 3620000, stock: 0, lead_time_weeks: 26, export_class: '4A090' },
  { sku: 'NV-QM9700', name: 'NVIDIA Quantum-2 QM9700 InfiniBand NDR switch, 64 ports', category: 'networking', oem: 'NVIDIA', power_kw: 1.7, rack_units: 1, list_price: 32000, cost: 27200, stock: 12, lead_time_weeks: 4, export_class: '5A992', attrs: { fabric: 'infiniband', ports: 64 } },
  { sku: 'NV-SN5600', name: 'NVIDIA Spectrum-X SN5600 800G Ethernet switch, 64 ports', category: 'networking', oem: 'NVIDIA', power_kw: 1.8, rack_units: 2, list_price: 38000, cost: 32500, stock: 8, lead_time_weeks: 5, export_class: '5A992', attrs: { fabric: 'ethernet', ports: 64 } },
  { sku: 'OPT-OSFP-800G', name: 'OSFP 800G optical transceiver', category: 'optics', oem: 'NVIDIA', list_price: 1100, cost: 850, stock: 2000, lead_time_weeks: 2, export_class: '5A992' },
  { sku: 'STO-PFS-1PB', name: 'High-performance parallel file storage, 1 PB appliance', category: 'storage', oem: 'WEKA', power_kw: 8, rack_units: 8, list_price: 520000, cost: 452000, stock: 2, lead_time_weeks: 6, export_class: '5A992' },
  { sku: 'SW-NVAIE-1Y', name: 'NVIDIA AI Enterprise, 1 year per GPU', category: 'software', oem: 'NVIDIA', unit: 'gpu-year', list_price: 4500, cost: 3600, stock: 100000, lead_time_weeks: 0, export_class: '5D992' },
  { sku: 'SVC-RACK-STACK', name: 'Rack and stack, cabling and power-on, per server', category: 'service', unit: 'server', list_price: 2500, cost: 1500, stock: 100000, lead_time_weeks: 1, export_class: 'EAR99' },
  { sku: 'SVC-CLUSTER-VAL', name: 'Cluster burn-in and validation (NCCL, HPL), per cluster', category: 'service', unit: 'cluster', list_price: 25000, cost: 14000, stock: 100000, lead_time_weeks: 1, export_class: 'EAR99' },
  { sku: 'SVC-NVL72-DEPLOY', name: 'Rack-scale deployment and liquid-cooling commissioning, per rack', category: 'service', unit: 'rack', list_price: 60000, cost: 38000, stock: 100000, lead_time_weeks: 2, export_class: 'EAR99' },
  { sku: 'SUP-3Y-NBD', name: '3-year next-business-day hardware support, per server', category: 'support', unit: 'server', list_price: 18000, cost: 12000, stock: 100000, lead_time_weeks: 0, export_class: 'EAR99' },
  { sku: 'SUP-3Y-NVL72', name: '3-year rack-scale support, per rack', category: 'support', unit: 'rack', list_price: 240000, cost: 168000, stock: 100000, lead_time_weeks: 0, export_class: 'EAR99' },
  { sku: 'RACK-48U-RDHX', name: '48U rack with rear-door heat exchanger (up to 48 kW)', category: 'rack_infra', list_price: 9500, cost: 7000, stock: 30, lead_time_weeks: 3, export_class: 'EAR99', attrs: { max_kw: 48, units: 48 } },
  { sku: 'PDU-3P-415V-PAIR', name: 'Pair of 3-phase 415V intelligent PDUs', category: 'rack_infra', unit: 'pair', list_price: 2800, cost: 2100, stock: 60, lead_time_weeks: 2, export_class: 'EAR99' },
];

/** Demo restricted-party list entries (fictitious names) so screening can be demonstrated. */
export const DEMO_RESTRICTED_PARTIES = [
  { name: 'Northwind Dual-Use Trading', country: 'Iran', list_name: 'DEMO Entity List', aliases: ['Northwind DUT'] },
  { name: 'Red Harbor Compute Ltd', country: 'Hong Kong', list_name: 'DEMO Entity List', aliases: ['Red Harbour Compute', 'RHC Ltd'] },
  { name: 'Volkov Advanced Systems', country: 'Russia', list_name: 'DEMO Denied Persons', aliases: ['VAS Group'] },
];
