/*
  Fictional supplier emails for trying Delay Assist on a demo company. One per
  situation the flow handles. The pattern reader must handle all three without
  AI, so a demo never depends on a network or a quota.
*/
export const DELAY_DEMO_EMAILS = [
  {
    id: 'ready',
    label: 'Goods ready, vessel delayed',
    text: `Dear buyer,

We are sorry to inform you that the vessel for your order has been rolled, and the sailing is pushed back about 30 days. Goods are packed and waiting at our warehouse. If it helps, we can release 6,000 pcs for an earlier shipment.

Best regards,
Sales team`,
  },
  {
    id: 'in_production',
    label: 'Still in production',
    text: `Dear buyer,

Unfortunately a coating line fault means your order is still in production. We expect a delay of 3 weeks. We will confirm the finish date once the line is repaired.

Best regards,
Sales team`,
  },
  {
    id: 'unclear',
    label: 'Delay only, no details',
    text: `Dear buyer,

Please note your shipment will be late by around 14 days because of port congestion. We will update you soon.

Best regards,
Sales team`,
  },
]
