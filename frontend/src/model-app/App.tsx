import { BrowserRouter, Routes, Route } from "react-router-dom";
import HomePage from "./pages/HomePage";
import EditorPage from "./pages/EditorPage";
import ModelOverviewPage from "./pages/ModelOverviewPage";
import VersionHistoryPage from "./pages/VersionHistoryPage";
import CatalogSearchPage from "./pages/CatalogSearchPage";
import SharedModelPage from "./pages/SharedModelPage";
import SharedEditorPage from "./pages/SharedEditorPage";
import SharedOverviewPage from "./pages/SharedOverviewPage";
import { KeyTips } from "./keytips";
import "./App.css";

export default function App() {
  return (
    <BrowserRouter basename="/model">
      <KeyTips />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/models/:id" element={<EditorPage />} />
        <Route path="/models/:id/overview" element={<ModelOverviewPage />} />
        <Route path="/models/:id/versions" element={<VersionHistoryPage />} />
        <Route path="/catalog" element={<CatalogSearchPage />} />
        <Route path="/share/:token" element={<SharedModelPage />} />
        <Route path="/share/:token/edit" element={<SharedEditorPage />} />
        <Route path="/share/:token/overview" element={<SharedOverviewPage />} />
      </Routes>
    </BrowserRouter>
  );
}
