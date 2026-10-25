import copy
import unittest
from unittest import mock

import prepare
import publish
import verify
from identity import fingerprint


class Controls(unittest.TestCase):
    def libraries(self, demo):
        return [artifact + "-" + version + ".jar"
                for artifact, versions in prepare.FLOORS[demo].items() for version in versions]

    def test_current_patch_floor_and_both_jackson_lines(self):
        for demo in [2, 3]:
            self.assertTrue(prepare.check_libraries(self.libraries(demo), demo))
        names = self.libraries(3)
        names.remove("jackson-databind-2.22.4.jar")
        with self.assertRaises(ValueError):
            prepare.check_libraries(names, 3)

    def test_missing_duplicate_old_and_unreviewed_major_are_rejected(self):
        names = self.libraries(2)
        for replacement in [[], ["spring-core-5.3.31.jar"], ["spring-core-6.2.0.jar"],
                            ["spring-core-5.3.39.jar", "spring-core-5.3.31.jar"],
                            ["spring-core-5.3.40-SNAPSHOT.jar"]]:
            with self.subTest(replacement=replacement), self.assertRaises(ValueError):
                prepare.check_libraries([n for n in names if not n.startswith("spring-core-")] + replacement, 2)

    def test_compatible_patch_increase_is_allowed(self):
        names = [n.replace("tomcat-embed-core-9.0.123", "tomcat-embed-core-9.0.124") for n in self.libraries(2)]
        self.assertTrue(prepare.check_libraries(names, 2))

    def run_record(self, **changes):
        result = dict(id=10, run_attempt=1, head_sha="source", event="push",
                      head_branch="master", status="completed", conclusion="success")
        result.update(changes)
        return result

    def test_build_gate_rejects_other_source_or_pr_green(self):
        for record in [self.run_record(head_sha="other"), self.run_record(event="pull_request"),
                       self.run_record(head_branch="feature")]:
            self.assertFalse(publish.successful_build([record], "source"))
        self.assertTrue(publish.successful_build([self.run_record()], "source"))

    def test_newer_failed_or_pending_build_cannot_reuse_old_green(self):
        for changes in [dict(id=11), dict(run_attempt=2)]:
            pending = self.run_record(**changes, status="in_progress", conclusion=None)
            self.assertFalse(publish.successful_build([self.run_record(), pending], "source"))
            failed = self.run_record(**changes, conclusion="failure")
            with self.assertRaises(RuntimeError):
                publish.successful_build([self.run_record(), failed], "source")

    def test_moved_master_rejects_promotion(self):
        with mock.patch.object(publish, "api", return_value={"sha": "new-source"}):
            with self.assertRaises(RuntimeError):
                publish.require_source("owner/repo", "old-source")

    def test_save_load_identity_ignores_backend_id_but_detects_content(self):
        image = dict(Id="backend-a", Architecture="amd64", Os="linux",
                     Config={"User": "10001:10001"}, RootFS={"Layers": ["sha256:original"]})
        restored = copy.deepcopy(image)
        restored["Id"] = "backend-b"
        self.assertEqual(fingerprint(image), fingerprint(restored))
        restored["Config"]["User"] = "0"
        self.assertNotEqual(fingerprint(image), fingerprint(restored))

        restored = copy.deepcopy(image)
        restored["RootFS"]["Layers"] = ["sha256:changed"]
        self.assertNotEqual(fingerprint(image), fingerprint(restored))

    def test_restart_reads_current_ephemeral_port(self):
        def container(port):
            return {"State": {"Running": True, "Health": {"Status": "healthy"}},
                    "NetworkSettings": {"Ports": {"8081/tcp": [{"HostIp": "127.0.0.1", "HostPort": port}]}}}
        response = mock.MagicMock()
        response.__enter__.return_value.status = 200
        with mock.patch.object(verify, "inspect", side_effect=[container("50001"), container("50002")]), \
                mock.patch.object(verify.urllib.request, "urlopen", return_value=response) as request:
            self.assertEqual(verify.ready("candidate", 8081), "http://127.0.0.1:50001")
            self.assertEqual(verify.ready("candidate", 8081), "http://127.0.0.1:50002")
            self.assertEqual([call.args[0] for call in request.call_args_list],
                             ["http://127.0.0.1:50001/doc.html", "http://127.0.0.1:50002/doc.html"])


if __name__ == "__main__":
    unittest.main()
