import { useCallback, useRef, useState } from "react";

export function useCustomerSelection(input: {
  requestedCustomerId: string;
  pathname: string;
  router: {
    replace: (href: string, options?: { scroll?: boolean }) => void;
  };
}) {
  const { requestedCustomerId, pathname, router } = input;
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const selectedCustomerIdRef = useRef("");

  const clearCustomerQuery = useCallback(() => {
    if (!requestedCustomerId) return;
    router.replace(pathname, { scroll: false });
  }, [pathname, requestedCustomerId, router]);

  const selectCustomer = useCallback((customerId: string) => {
    setSelectedCustomerId(customerId);
    selectedCustomerIdRef.current = customerId;
    clearCustomerQuery();
  }, [clearCustomerQuery]);

  const collapseSelection = useCallback(() => {
    setSelectedCustomerId("");
    selectedCustomerIdRef.current = "";
    clearCustomerQuery();
  }, [clearCustomerQuery]);

  const syncFromRequestedCustomer = useCallback((customerIds: string[]) => {
    if (!requestedCustomerId) return false;
    if (!customerIds.includes(requestedCustomerId)) return false;
    if (selectedCustomerIdRef.current === requestedCustomerId) {
      clearCustomerQuery();
      return false;
    }
    setSelectedCustomerId(requestedCustomerId);
    selectedCustomerIdRef.current = requestedCustomerId;
    clearCustomerQuery();
    return true;
  }, [clearCustomerQuery, requestedCustomerId]);

  return {
    state: {
      selectedCustomerId,
    },
    refs: {
      selectedCustomerIdRef,
    },
    actions: {
      setSelectedCustomerId,
      selectCustomer,
      collapseSelection,
      clearCustomerQuery,
      syncFromRequestedCustomer,
    },
  };
}
