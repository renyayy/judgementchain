import { useEffect, useRef } from "react";
import { Menu, MenuItem, Submenu, PredefinedMenuItem } from "@tauri-apps/api/menu";

interface MenuActions {
  onOpenVault: () => void;
  onOpenFolder: () => void;
  onCloseFolder: () => void;
  onNewNote: () => void;
}

export function useAppMenu(actions: MenuActions) {
  const actionsRef = useRef(actions);
  actionsRef.current = actions;

  useEffect(() => {
    async function buildMenu() {
      const fileMenu = await Submenu.new({
        text: "File",
        items: [
          await MenuItem.new({
            text: "Open Vault...",
            action: () => actionsRef.current.onOpenVault(),
          }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({
            text: "Open Folder",
            action: () => actionsRef.current.onOpenFolder(),
          }),
          await MenuItem.new({
            text: "Close Folder",
            action: () => actionsRef.current.onCloseFolder(),
          }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await MenuItem.new({
            text: "New Note",
            accelerator: "CmdOrCtrl+N",
            action: () => actionsRef.current.onNewNote(),
          }),
        ],
      });

      const appMenu = await Submenu.new({
        text: "Nomos",
        items: [
          await PredefinedMenuItem.new({ item: "Hide" }),
          await PredefinedMenuItem.new({ item: "HideOthers" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Quit" }),
        ],
      });

      const editMenu = await Submenu.new({
        text: "Edit",
        items: [
          await PredefinedMenuItem.new({ item: "Undo" }),
          await PredefinedMenuItem.new({ item: "Redo" }),
          await PredefinedMenuItem.new({ item: "Separator" }),
          await PredefinedMenuItem.new({ item: "Cut" }),
          await PredefinedMenuItem.new({ item: "Copy" }),
          await PredefinedMenuItem.new({ item: "Paste" }),
          await PredefinedMenuItem.new({ item: "SelectAll" }),
        ],
      });

      const menu = await Menu.new({ items: [appMenu, fileMenu, editMenu] });
      await menu.setAsAppMenu();
    }

    buildMenu().catch(console.error);
  }, []);
}
