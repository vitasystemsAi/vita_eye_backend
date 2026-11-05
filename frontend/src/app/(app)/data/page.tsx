'use client';

import { DataExchange } from '@/components/data/DataExchange';
import { RequirePermission } from '@/components/RequirePermission';

export default function DataPage() {
  return (
    <RequirePermission permission="data:export">
      <DataExchange />
    </RequirePermission>
  );
}
