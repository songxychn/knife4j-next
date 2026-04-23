import React from "react";
import clsx from "clsx";
import Layout from "@theme/Layout";
import Link from "@docusaurus/Link";
import CodeBlock from "@theme/CodeBlock";
import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import styles from "./index.module.css";
import Hightlights from "../components/Highlights";

function Hero() {
  return (
    <header className={clsx("container", styles.heroBanner)}>
      <div className="row padding-horiz--md">
        <div className="col col--12">
          <div className={clsx(styles.relative, "row")}>
            <div className="col">
              <h1 className={styles.tagline}>
                Knife4j Next 是一个面向社区持续维护的
                <br /> API 文档增强方案
              </h1>
              <h1 className={styles.tagline}>
                <span>Knife4j Next</span> 聚焦 <span>兼容性修复</span>、
                <span>稳定发布</span>
                <br /> 与 <span>下一代前端演进</span>
              </h1>
            </div>
          </div>
          <div className="row">
            <div className="col">
              <h2>兼容保留 doc.html 体验，并为社区提供更可预期的维护节奏。</h2>
            </div>
          </div>
          <div className="row">
            <div className="col">
              <div className={styles.heroButtons}>
                <Link to="docs/quick-start" className={styles.getStarted}>
                  Get Started
                </Link>
                <iframe
                  src="https://ghbtns.com/github-btn.html?user=songxychn&repo=knife4j-next&type=star&count=true&size=large"
                  frameBorder="0"
                  scrolling="0"
                  width="170"
                  height="30"
                  title="GitHub"
                ></iframe>
              </div>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}

const example = `@Configuration
@EnableSwagger2WebMvc
public class Knife4jConfiguration {

    @Bean(value = "dockerBean")
    public Docket dockerBean() {
        //指定使用Swagger2规范
        Docket docket=new Docket(DocumentationType.SWAGGER_2)
                .apiInfo(new ApiInfoBuilder()
                //描述字段支持Markdown语法
                .description("# Knife4j Next RESTful APIs")
                .termsOfServiceUrl("https://github.com/songxychn/knife4j-next")
                .contact("Baizhukui")
                .version("1.0")
                .build())
                //分组名称
                .groupName("用户服务")
                .select()
                //这里指定Controller扫描包路径
                .apis(RequestHandlerSelectors.basePackage("com.example.demo.controller"))
                .paths(PathSelectors.any())
                .build();
        return docket;
    }
}
`;

const mavenDependency = `<!--引入Knife4j的官方start包,该指南选择Spring Boot版本<3.0,开发者需要注意-->
<dependency>
    <groupId>com.baizhukui</groupId>
    <artifactId>knife4j-openapi2-spring-boot-starter</artifactId>
    <version>4.6.0.1</version>
</dependency>

`;

const controllerExample = `@Api(tags = "首页模块")
@RestController
public class IndexController {

    @ApiImplicitParam(name = "name",value = "姓名",required = true)
    @ApiOperation(value = "向客人问好")
    @GetMapping("/sayHi")
    public ResponseEntity<String> sayHi(@RequestParam(value = "name")String name){
        return ResponseEntity.ok("Hi:"+name);
    }
}`;

function ActorExample() {
  return (
    <section className={clsx(styles.try, "container")}>
      <div className="col">
        <h2>快速开始(Spring Boot 2 + OpenAPI2)</h2>

        <p>
          不同规范以及Spring Boot3 OpenAPI3的使用请移步
          <a href="docs/quick-start">详细文档</a>
        </p>
        <p>
          第一步：
          <a href="https://spring.io/guides/gs/spring-boot/">
            创建Spring Boot项目
          </a>
          并且在pom.xml中引入
          <a href="https://search.maven.org/search?q=g:com.baizhukui">
            Knife4j Next 的依赖包
          </a>
          ，代码如下：
        </p>
        <CodeBlock className="language-xml">{mavenDependency}</CodeBlock>
        <p>第二步：创建Swagger配置依赖，代码如下：：</p>
        <CodeBlock className="language-javascript">{example}</CodeBlock>
        <p>第三步:新建一个接口Controller类，如下：</p>
        <CodeBlock className="language-javascript">
          {controllerExample}
        </CodeBlock>
        <p>
          万事俱备，启动Spring Boot项目，浏览器访问Knife4j的文档地址即可查看效果
        </p>
        <CodeBlock className="language-bash">
          http://localhost:8080/doc.html
        </CodeBlock>
      </div>
    </section>
  );
}

function Contributor({ name, url, avatar }) {
  return (
    <div className={styles.contributor}>
      <a href={url} target="_blank">
        <div alt={name} title={name}>
          <img src={avatar} />
        </div>
      </a>
    </div>
  );
}

function Organization({ name, url, avatar }) {
  return (
    <div className={styles.organization}>
      <a href={url} target="_blank">
        <div alt={name} title={name}>
          <img src={avatar} />
        </div>
      </a>
    </div>
  );
}

function Knife4jFramWork() {
  return (
    <section className={clsx(styles.try, "container")}>
      <div className="col">
        <img src="/images/website/knife4j-framework2.png" />
      </div>
    </section>
  );
}

function Contributors() {
  const contributorDatas = require("../../static/json/contributors1.json");

  return (
    <section className={clsx(styles.try, "container")}>
      <div className="col">
        <div className={styles.contributorsHeader}>
          <h1>Contributors</h1>
          <div>Knife4j的发展离不开每一位Contributor的无私奉献～～！</div>
        </div>
        <div className={styles.contributos}>
          {contributorDatas.map((props, idx) => (
            <Contributor key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

function UseOrganization() {
  const contributorDatas = require("../../static/json/use_organization.json");

  return (
    <section className={clsx(styles.try, "container")}>
      <div className="col">
        <div className={styles.organizationsHeader}>
          <h1>正在使用 Knife4j 的企业 / 机构</h1>
          <div>
            （如果您的企业也使用了 Knife4j Next，欢迎在{" "}
            <a
              href="https://github.com/songxychn/knife4j-next/issues"
              target="_blank"
            >
              Issues
            </a>{" "}
            中告诉我们）
          </div>
        </div>
        <div className={styles.organizations}>
          {contributorDatas.map((props, idx) => (
            <Organization key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const SvgLogo = require("../../static/img/knife4j-logo.svg").default;
  const { siteConfig } = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title} · ${siteConfig.tagline}`}
      description={siteConfig.description}
    >
      <Hero />
      <Hightlights />
      <Knife4jFramWork />
      <UseOrganization />
      <Contributors />
      <ActorExample />

      <div className="container">
        <div className="row">
          <div className="col text--center padding-top--lg padding-bottom--xl">
            <SvgLogo className={styles.bottomLogo} />
          </div>
        </div>
      </div>
    </Layout>
  );
}
