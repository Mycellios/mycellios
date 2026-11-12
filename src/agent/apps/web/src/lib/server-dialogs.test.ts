import { afterEach, expect, it, vi } from "vitest";
import { closeServerDialog, openServerDialog, serverDialogSnapshot, subscribeServerDialog } from "./server-dialogs";
afterEach(()=>closeServerDialog());
it("does not let a late save close a newer server request",()=>{
 openServerDialog({kind:"add",ownerId:"alice",currentUrl:"https://a.test"});const old=serverDialogSnapshot()!;
 openServerDialog({kind:"add",ownerId:"alice",currentUrl:"https://b.test"});closeServerDialog(old.id);expect(serverDialogSnapshot()).toMatchObject({currentUrl:"https://b.test"});
});
it("notifies mounted hosts and removes subscriptions on cleanup",()=>{
 const listener=vi.fn(),unsubscribe=subscribeServerDialog(listener);openServerDialog({kind:"add",ownerId:"alice",currentUrl:"https://a.test"});expect(listener).toHaveBeenCalledOnce();unsubscribe();closeServerDialog();expect(listener).toHaveBeenCalledOnce();expect(serverDialogSnapshot()).toBeNull();
});
