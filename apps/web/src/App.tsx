import { Route, Routes } from "react-router-dom";

import AdminPage from "./routes/AdminPage";
import DevDeckPage from "./routes/DevDeckPage";
import DisplayPage from "./routes/DisplayPage";
import HomePage from "./routes/HomePage";
import InvitePage from "./routes/InvitePage";
import ModPage from "./routes/ModPage";
import ParticipantPage from "./routes/ParticipantPage";
import ShowcasePage from "./routes/ShowcasePage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/showcase" element={<ShowcasePage />} />
      <Route path="/i/:token" element={<InvitePage />} />
      <Route path="/s/:code" element={<ParticipantPage />} />
      <Route path="/s/:code/display/:screen" element={<DisplayPage />} />
      <Route path="/s/:code/dev" element={<DevDeckPage />} />
      <Route path="/s/:code/admin" element={<AdminPage />} />
      <Route path="/s/:code/mod" element={<ModPage />} />
      {/* compat */}
      <Route path="/admin/:code" element={<AdminPage />} />
      <Route path="/mod/:code" element={<ModPage />} />
    </Routes>
  );
}
