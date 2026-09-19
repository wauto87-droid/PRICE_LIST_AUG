import { TrackerProvider } from '@/frontend/dn-tracker/TrackerContext';
import FulfillmentEngine from '@/frontend/dn-tracker/FulfillmentEngine';

export const metadata = {
  title: 'Find Non-Invoiced Companies from DN',
  description: 'Order Fulfillment & Workflow Kanban Engine'
};

export default function DNTrackerPage() {
  return (
    <TrackerProvider>
      <FulfillmentEngine />
    </TrackerProvider>
  );
}
