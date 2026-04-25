package com.baizhukui.knife4j.demo;

import org.springframework.stereotype.Controller;
import org.springframework.web.bind.annotation.GetMapping;

@Controller
public class RootRedirectController {

    @GetMapping("/")
    public String redirectToDoc() {
        return "redirect:/doc.html";
    }
}
