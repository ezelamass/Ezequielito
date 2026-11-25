import React from "react";
import { VentoAccount } from "../../account/VentoAccount";

export const AccountSettings: React.FC = () => {
  return (
    <div className="max-w-3xl w-full mx-auto space-y-6">
      <VentoAccount variant="settings" />
    </div>
  );
};
